// videoDataRouter.ts
import { celebrate, Segments } from 'celebrate';
import crypto from 'crypto';
import { Request, Response, Router } from 'express';
import ffmpegStatic from 'ffmpeg-static';
import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import Joi from 'joi';
import path from 'path';
import KnexDatabase from '../server/KnexDatabase';

ffmpeg.setFfmpegPath(ffmpegStatic);

const db = KnexDatabase;
const router = Router();

/**
 * Inicializa la tabla "video_compositions" si no existe.
 * 
 * - En esta función no tenemos un `id` de composición (porque se llama antes de crear el registro);
 *   por lo tanto, en caso de error, no se puede registrar en "steps" de la BD.
 * - Sin embargo, sí registramos logs y lanzamos la excepción para que sea manejada
 *   posteriormente (p.ej., en la ruta que la invoque).
 */
async function initializeVideoCompositionTable(): Promise<void> {
    try {
        const exists = await db.schema.hasTable('video_compositions');
        if (!exists) {
            console.log('[DB] Creando tabla "video_compositions"...');
            await db.schema.createTable('video_compositions', (table) => {
                table.string('id').primary();
                table.string('status').notNullable();
                table.json('steps').defaultTo(JSON.stringify([]));
                table.string('folder_path').notNullable();
                table.string('video_path').nullable();
                table.timestamp('expiration_time').nullable();
                table.timestamps(true, true);
            });
            console.log('[DB] Tabla "video_compositions" creada con éxito.');
        }
    } catch (error) {
        console.error('[DB] Error al inicializar la tabla "video_compositions":', error);
        throw error; // se re-lanza el error para que lo maneje quien llame a esta función
    }
}

/**
 * Crea el registro inicial para el proceso de composición en la tabla "video_compositions".
 * Retorna los pasos actualizados en caso de éxito, para que podamos seguir agregando.
 */
async function createVideoCompositionRecord(record: {
    id: string;
    status: string;
    steps?: string[];
    folder_path: string;
}): Promise<string[]> {
    try {
        const steps = record.steps || [];
        await db('video_compositions').insert({
            ...record,
            steps: JSON.stringify(steps)
        });
        console.log(`[DB] Registro de composición creado. ID: ${record.id}, status: ${record.status}`);
        return steps;
    } catch (error) {
        console.error('[DB] Error al crear registro de composición:', error);
        throw error;
    }
}

/**
 * Lee el registro actual de "video_compositions" para obtener la lista de steps,
 * y devuelve ese array (o uno vacío si no existe).
 */
async function getCurrentSteps(id: string): Promise<string[]> {
    try {
        const row = await db('video_compositions').where({ id }).first();
        if (row) {
            return JSON.parse(row.steps || '[]');
        }
        return [];
    } catch (error) {
        console.error(`[DB] Error al obtener steps para ID: ${id}`, error);
        return [];
    }
}

/**
 * Actualiza el registro del proceso de composición.
 * - `updates.steps`: si se provee, se convertirá a JSON tras recuperar los steps actuales.
 */
async function updateVideoCompositionProgress(
    id: string,
    updates: Partial<{
        status: string;
        steps: string[];
        video_path: string;
        expiration_time: Date;
    }>
): Promise<void> {
    try {
        const currentSteps = await getCurrentSteps(id);
        let mergedSteps = currentSteps;
        if (updates.steps && updates.steps.length > 0) {
            // merge steps: concatenar sin duplicar
            mergedSteps = currentSteps.concat(updates.steps);
        }

        const updateData: any = {
            ...updates,
            steps: JSON.stringify(mergedSteps),
            updated_at: db.fn.now()
        };

        await db('video_compositions').where({ id }).update(updateData);
        console.log(`[DB] Registro de composición actualizado. ID: ${id}, Updates:`, updates);
    } catch (error) {
        console.error('[DB] Error al actualizar registro de composición:', error);
        throw error;
    }
}

/**
 * Esquema de validación para la nueva estructura de composición de video.
 * Recibe:
 *  - assets[]: { id, type, source, aspecs... }
 *  - timeline[]: { assetId, startTime, override... }
 *  - globalSettings: { resolution, outputFormat }
 */
const videoCompositionSchema = Joi.object({
    assets: Joi.array()
        .items(
            Joi.object({
                id: Joi.string().required(),
                type: Joi.string().valid('video', 'audio', 'text', 'image').required(),
                source: Joi.object({
                    url: Joi.string().uri().optional(),
                    data_base64: Joi.string().optional(),
                    content: Joi.string().optional()
                }).required(),
                aspecs: Joi.object({
                    startTrim: Joi.number().default(0),
                    duration: Joi.number().required(),
                    resolution: Joi.object({
                        width: Joi.number().required(),
                        height: Joi.number().required()
                    }).optional(),
                    position: Joi.object({
                        x: Joi.number().required(),
                        y: Joi.number().required()
                    }).optional(),
                    effects: Joi.object({
                        transitionIn: Joi.object({
                            type: Joi.string().valid('fade', 'slide').optional(),
                            duration: Joi.number().optional()
                        }).optional(),
                        transitionOut: Joi.object({
                            type: Joi.string().valid('fade', 'slide').optional(),
                            duration: Joi.number().optional()
                        }).optional(),
                        animation: Joi.string().optional(),
                        speed: Joi.number().optional()
                    }).optional(),
                    volume: Joi.number().optional(),
                    font: Joi.string().optional(),
                    fontSize: Joi.number().optional(),
                    color: Joi.string().optional()
                }).required()
            })
        )
        .required(),

    timeline: Joi.array()
        .items(
            Joi.object({
                assetId: Joi.string().required(),
                startTime: Joi.number().required(),
                override: Joi.object({
                    position: Joi.object({
                        x: Joi.number(),
                        y: Joi.number()
                    }).optional(),
                    effects: Joi.object({
                        transitionIn: Joi.object({
                            type: Joi.string().valid('fade', 'slide').optional(),
                            duration: Joi.number().optional()
                        }).optional(),
                        transitionOut: Joi.object({
                            type: Joi.string().valid('fade', 'slide').optional(),
                            duration: Joi.number().optional()
                        }).optional(),
                        animation: Joi.string().optional(),
                        speed: Joi.number().optional()
                    }).optional()
                }).optional()
            })
        )
        .required(),

    globalSettings: Joi.object({
        resolution: Joi.object({
            width: Joi.number().required(),
            height: Joi.number().required()
        }).required(),
        outputFormat: Joi.string().valid('mp4', 'mov').default('mp4')
    }).required()
});

/**
 * Transforma la data (assets/timeline/globalSettings) en un arreglo
 * simplificado de clips (solo video/audio) para trim+concat con ffmpeg.
 * Se añade try/catch interno para capturar fallos potenciales.
 */
function transformToConcatClips(assets: any[], timeline: any[], globalSettings: any) {
    try {
        console.log('[transformToConcatClips] Iniciando transformación de datos para ffmpeg.');

        const sortedTimeline = [...timeline].sort((a, b) => a.startTime - b.startTime);

        const clips: Array<{
            src: string;
            start: number;
            duration: number;
        }> = [];

        for (const item of sortedTimeline) {
            const asset = assets.find((a) => a.id === item.assetId);
            if (!asset) {
                console.warn(`[transformToConcatClips] No se encontró el asset con id: ${item.assetId}. Se omitirá.`);
                continue;
            }

            if (asset.type === 'video' || asset.type === 'audio') {
                const startTrimMs = asset.aspecs.startTrim ?? 0;
                const durationMs = asset.aspecs.duration;
                const startSeconds = startTrimMs / 1000;
                const durationSeconds = durationMs / 1000;

                // Solo lo agregamos si existe una URL
                if (asset.source?.url) {
                    clips.push({
                        src: asset.source.url,
                        start: startSeconds,
                        duration: durationSeconds
                    });
                    console.log(
                        `[transformToConcatClips] Clip agregado: ${asset.type} | src=${asset.source.url} | start=${startSeconds}s | duration=${durationSeconds}s.`
                    );
                } else {
                    console.warn(
                        `[transformToConcatClips] El asset ${asset.id} no tiene 'source.url'. No se agregará al proceso.`
                    );
                }
            } else {
                console.log(`[transformToConcatClips] Ignorando asset de tipo ${asset.type}. (Se requiere lógica overlay)`);
            }
        }

        // Retornamos el objeto con la lista de clips y el formato
        return {
            clips,
            outputFormat: globalSettings.outputFormat
        };
    } catch (error) {
        console.error('[transformToConcatClips] Error al transformar datos:', error);
        throw error;
    }
}

/**
 * Usa ffmpeg para hacer trim y concat de un conjunto de clips (video/audio).
 * Retorna la ruta del archivo generado.
 * Se maneja try/catch a nivel de promesa, y se propaga el error si ocurre.
 */
async function composeVideo(compositionData: any): Promise<string> {
    try {
        console.log('[composeVideo] Iniciando proceso de composición con ffmpeg.');

        const composedDir = path.join(process.cwd(), 'data', 'composedVideos');
        if (!fs.existsSync(composedDir)) {
            fs.mkdirSync(composedDir, { recursive: true });
            console.log(`[composeVideo] Creada carpeta para videos compuestos: ${composedDir}`);
        }

        const outputFilename = `video-${Date.now()}.${compositionData.outputFormat}`;
        const outputPath = path.join(composedDir, outputFilename);

        // Construcción del filtro complejo para trim y concat
        const filterInputs: string[] = [];
        compositionData.clips.forEach((clip: any, index: number) => {
            filterInputs.push(
                `[${index}:v]trim=start=${clip.start}:duration=${clip.duration},setpts=PTS-STARTPTS[v${index}]`
            );
            filterInputs.push(
                `[${index}:a]atrim=start=${clip.start}:duration=${clip.duration},asetpts=PTS-STARTPTS[a${index}]`
            );
        });

        let videoStreams = '';
        let audioStreams = '';
        for (let i = 0; i < compositionData.clips.length; i++) {
            videoStreams += `[v${i}]`;
            audioStreams += `[a${i}]`;
        }

        const concatFilter = `${videoStreams}${audioStreams}concat=n=${compositionData.clips.length}:v=1:a=1[outv][outa]`;
        const fullFilter = [...filterInputs, concatFilter].join(';');

        console.log('[composeVideo] Filtro ffmpeg:', fullFilter);
        console.log('[composeVideo] Generando archivo de salida en:', outputPath);

        // Retornamos una promesa que se resuelve cuando ffmpeg termina
        return await new Promise((resolve, reject) => {
            const command = ffmpeg();

            compositionData.clips.forEach((clip: any) => {
                command.input(clip.src);
            });

            command
                .complexFilter(fullFilter, ['outv', 'outa'])
                .outputOptions('-map', '[outv]', '-map', '[outa]')
                .output(outputPath)
                .on('start', () => {
                    console.log('[composeVideo] ffmpeg proceso iniciado...');
                })
                .on('progress', (progress) => {
                    console.log(`[composeVideo] Progreso: ${Math.floor(progress.percent || 0)}% (frame=${progress.frames})`);
                })
                .on('end', () => {
                    console.log('[composeVideo] ffmpeg proceso finalizado. Video disponible en:', outputPath);
                    resolve(outputPath);
                })
                .on('error', (err: Error) => {
                    console.error('[composeVideo] Error en ffmpeg:', err);
                    reject(err);
                })
                .run();
        });
    } catch (error) {
        console.error('[composeVideo] Error general antes de iniciar ffmpeg:', error);
        throw error;
    }
}

/**
 * @swagger
 * /api/videos/compose:
 *   post:
 *     tags: [/api/video]
 *     summary: Componer video a partir de un JSON de composición
 *     description: >
 *       Recibe un JSON que describe la composición del video (incluye video, audio, texto e imágenes).
 *       Actualmente, el sistema solo concatena y recorta (trim) recursos de tipo video/audio,
 *       registrando el proceso en la base de datos y devolviendo la ruta del video final.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               assets:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     type:
 *                       type: string
 *                       enum: [video, audio, text, image]
 *                     source:
 *                       type: object
 *                       properties:
 *                         url:
 *                           type: string
 *                           format: uri
 *                         data_base64:
 *                           type: string
 *                         content:
 *                           type: string
 *                     aspecs:
 *                       type: object
 *                       properties:
 *                         startTrim:
 *                           type: number
 *                         duration:
 *                           type: number
 *                         resolution:
 *                           type: object
 *                           properties:
 *                             width:
 *                               type: number
 *                             height:
 *                               type: number
 *                         position:
 *                           type: object
 *                           properties:
 *                             x:
 *                               type: number
 *                             y:
 *                               type: number
 *                         effects:
 *                           type: object
 *                           properties:
 *                             transitionIn:
 *                               type: object
 *                             transitionOut:
 *                               type: object
 *                             animation:
 *                               type: string
 *                             speed:
 *                               type: number
 *                         volume:
 *                           type: number
 *                         font:
 *                           type: string
 *                         fontSize:
 *                           type: number
 *                         color:
 *                           type: string
 *               timeline:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     assetId:
 *                       type: string
 *                     startTime:
 *                       type: number
 *                     override:
 *                       type: object
 *                       properties:
 *                         position:
 *                           type: object
 *                           properties:
 *                             x:
 *                               type: number
 *                             y:
 *                               type: number
 *                         effects:
 *                           type: object
 *                           properties:
 *                             transitionIn:
 *                               type: object
 *                             transitionOut:
 *                               type: object
 *                             animation:
 *                               type: string
 *                             speed:
 *                               type: number
 *               globalSettings:
 *                 type: object
 *                 properties:
 *                   resolution:
 *                     type: object
 *                     properties:
 *                       width:
 *                         type: number
 *                       height:
 *                         type: number
 *                   outputFormat:
 *                     type: string
 *                     enum: [mp4, mov]
 *                     default: mp4
 *     responses:
 *       200:
 *         description: Video generado exitosamente.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                 outputPath:
 *                   type: string
 *                 message:
 *                   type: string
 */
router.post(
    '/api/videos/compose',
    celebrate({
        [Segments.BODY]: videoCompositionSchema
    }),
    async (req: Request, res: Response): Promise<any> => {
        let requestId = '';
        try {
            console.log('[POST /api/videos/compose] Solicitud de composición recibida.');

            // 1) Inicializar tabla (si no existe)
            try {
                await initializeVideoCompositionTable();
                console.log('[POST /api/videos/compose] Step: "table_initialization_success".');
            } catch (tableError) {
                console.error('[POST /api/videos/compose] Step: "table_initialization_failure".', tableError);
                return res.status(500).json({
                    status: 'error',
                    message: 'No se pudo inicializar la tabla de composiciones.',
                    error: tableError.message
                });
            }

            // 2) Generar ID único para la composición
            requestId = crypto.randomBytes(16).toString('hex');

            // 3) Crear carpeta para almacenar assets/resultado
            const folderPath = path.join(process.cwd(), 'data', 'composeVideo', requestId);
            try {
                fs.mkdirSync(folderPath, { recursive: true });
                console.log('[POST /api/videos/compose] Step: "folder_creation_success".');
            } catch (mkError) {
                console.error('[POST /api/videos/compose] Step: "folder_creation_failure".', mkError);
                return res.status(500).json({
                    status: 'error',
                    message: 'No se pudo crear la carpeta de almacenamiento de composición.',
                    error: mkError.message
                });
            }

            // 4) Crear registro inicial en la BD
            let stepsInDb: string[] = [];
            try {
                stepsInDb = await createVideoCompositionRecord({
                    id: requestId,
                    status: 'in_progress',
                    steps: ['record_creation_success'],
                    folder_path: folderPath
                });
            } catch (recordError) {
                console.error('[POST /api/videos/compose] Step: "record_creation_failure".', recordError);
                return res.status(500).json({
                    status: 'error',
                    message: 'No se pudo crear el registro de la composición en la BD.',
                    error: recordError.message
                });
            }

            // 5) Transformar data (assets/timeline/globalSettings)
            const { assets, timeline, globalSettings } = req.body;
            let concatData: { clips: any[]; outputFormat: string };
            try {
                concatData = transformToConcatClips(assets, timeline, globalSettings);
                // Actualizar steps con "transform_clips_success"
                await updateVideoCompositionProgress(requestId, {
                    steps: ['transform_clips_success']
                });
            } catch (transformError) {
                console.error('[POST /api/videos/compose] Step: "transform_clips_failure".', transformError);
                await updateVideoCompositionProgress(requestId, {
                    status: 'failed',
                    steps: ['transform_clips_failure']
                });
                return res.status(400).json({
                    status: 'error',
                    message: 'Ocurrió un error al transformar los datos de composición.',
                    error: transformError.message
                });
            }

            // Verificamos que haya clips de video/audio
            if (!concatData.clips.length) {
                const noClipsError = 'No se encontraron clips de video/audio para procesar.';
                console.error('[POST /api/videos/compose]', noClipsError);
                await updateVideoCompositionProgress(requestId, {
                    status: 'failed',
                    steps: ['no_valid_clips_found']
                });
                return res.status(400).json({
                    status: 'error',
                    message: noClipsError
                });
            }

            // 6) Componer video (trim+concat)
            let outputPath: string;
            try {
                outputPath = await composeVideo(concatData);

                // Actualizar steps con "compose_video_success"
                await updateVideoCompositionProgress(requestId, {
                    steps: ['compose_video_success']
                });
            } catch (composeErr) {
                console.error('[POST /api/videos/compose] Step: "compose_video_failure".', composeErr);
                await updateVideoCompositionProgress(requestId, {
                    status: 'failed',
                    steps: ['compose_video_failure']
                });
                return res.status(400).json({
                    status: 'error',
                    message: 'Ocurrió un error al componer el video con ffmpeg.',
                    error: composeErr.message
                });
            }

            // 7) Marcar como "completed"
            try {
                await updateVideoCompositionProgress(requestId, {
                    status: 'completed',
                    steps: ['video_composed'],
                    video_path: outputPath,
                    expiration_time: new Date(Date.now() + 60 * 60 * 1000) // 1 hora
                });
            } catch (updateError) {
                console.error('[POST /api/videos/compose] Step: "update_composition_failure".', updateError);
                // No retornamos aquí, solo loggeamos, porque el video ya se compuso con éxito.
            }

            console.log(`[POST /api/videos/compose] Proceso de composición completado (ID: ${requestId}).`);
            res.status(200).json({
                status: 'success',
                outputPath,
                message: 'Vídeo generado exitosamente'
            });
        } catch (error: any) {
            console.error(`[POST /api/videos/compose] Error general en la ruta de composición (ID: ${requestId}):`, error);

            // Si tenemos un ID, intentamos actualizar el estado a "failed"
            if (requestId) {
                try {
                    await updateVideoCompositionProgress(requestId, {
                        status: 'failed',
                        steps: ['failed_in_general_catch']
                    });
                } catch (dbError) {
                    console.error('[POST /api/videos/compose] Error al actualizar BD tras fallo general:', dbError);
                }
            }

            res.status(400).json({
                status: 'error',
                message: error.message || 'Error desconocido en la composición de video.'
            });
        }
    }
);

/**
 * Método opcional para consultar estado de la composición:
 *   GET /api/videos/status/:id
 */
router.get('/api/videos/status/:id', async (req: Request, res: Response): Promise<any> => {
    const { id } = req.params;
    try {
        console.log(`[GET /api/videos/status] Consultando estado de la composición ID: ${id}.`);

        const composition = await db('video_compositions').where({ id }).first();
        if (!composition) {
            return res.status(404).json({ error: 'No existe una composición con ese ID.' });
        }

        res.json({
            id: composition.id,
            status: composition.status,
            steps: JSON.parse(composition.steps || '[]'),
            video_path: composition.video_path,
            expiration_time: composition.expiration_time,
            created_at: composition.created_at,
            updated_at: composition.updated_at
        });
    } catch (error: any) {
        console.error('[GET /api/videos/status/:id] Error al obtener estado:', error);
        res.status(500).json({ error: 'Error interno al consultar el estado de la composición.' });
    }
});

export const api_router_video = router;
export default router;
