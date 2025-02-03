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
 * Esta tabla almacenará el estado del proceso de composición, los pasos ejecutados,
 * la ruta de la carpeta asociada, la URL del video final y la fecha de expiración.
 */
async function initializeVideoCompositionTable(): Promise<void> {
    const exists = await db.schema.hasTable('video_compositions');
    if (!exists) {
        await db.schema.createTable('video_compositions', (table) => {
            table.string('id').primary();
            table.string('status').notNullable(); // Ejemplo: "in_progress", "completed", "failed"
            table.json('steps').defaultTo(JSON.stringify([])); // Registro de pasos ejecutados
            table.string('folder_path').notNullable();
            table.string('video_url').nullable();
            table.timestamp('expiration_time').nullable(); // Momento en que se eliminará la carpeta
            table.timestamps(true, true);
        });
    }
}

/**
 * Crea un registro inicial para el proceso de composición.
 * @param record - Objeto con los datos iniciales del proceso.
 */
async function createVideoCompositionRecord(record: {
    id: string;
    status: string;
    steps?: string[];
    folder_path: string;
}): Promise<void> {
    await db('video_compositions').insert({
        ...record,
        steps: JSON.stringify(record.steps || [])
    });
}

/**
 * Actualiza el registro del proceso de composición.
 * @param id - Identificador del proceso.
 * @param updates - Datos a actualizar: estado, pasos, URL del video y fecha de expiración.
 */
async function updateVideoCompositionProgress(
    id: string,
    updates: Partial<{ status: string; steps: string[]; video_url: string; expiration_time: Date }>
): Promise<void> {
    const updateData: any = { ...updates };
    if (updates.steps) {
        updateData.steps = JSON.stringify(updates.steps);
    }
    updateData.updated_at = db.fn.now();
    await db('video_compositions').where({ id }).update(updateData);
}

/**
 * Esquema de validación para la composición de video.
 */
const videoCompositionSchema = Joi.object({
    clips: Joi.array()
        .items(
            Joi.object({
                src: Joi.string().uri().required(),
                start: Joi.number().required(),
                duration: Joi.number().required()
            })
        )
        .required(),
    outputFormat: Joi.string().valid('mp4', 'mov').default('mp4')
});

/**
 * Función que compone el video utilizando ffmpeg y un filtro complejo.
 * Se recorta cada clip según los tiempos indicados y se concatenan en un solo video.
 * @param compositionData - Objeto que contiene los clips y el formato de salida.
 * @returns Una promesa que resuelve con la URL del video generado.
 */
async function composeVideo(compositionData: any): Promise<string> {
    return new Promise((resolve, reject) => {
        // Directorio donde se guardarán los videos compuestos
        const composedDir = path.join(process.cwd(), 'data', 'composedVideos');
        if (!fs.existsSync(composedDir)) {
            fs.mkdirSync(composedDir, { recursive: true });
        }
        const outputFilename = `video-${Date.now()}.${compositionData.outputFormat}`;
        const outputPath = path.join(composedDir, outputFilename);

        // Se arma el filtro complejo:
        // Para cada clip se utiliza "trim" y "atrim" para extraer la parte deseada,
        // luego se concatenan todos los segmentos.
        const filterInputs: string[] = [];
        compositionData.clips.forEach((clip: any, index: number) => {
            filterInputs.push(
                `[${index}:v]trim=start=${clip.start}:duration=${clip.duration},setpts=PTS-STARTPTS[v${index}]`
            );
            filterInputs.push(
                `[${index}:a]atrim=start=${clip.start}:duration=${clip.duration},asetpts=PTS-STARTPTS[a${index}]`
            );
        });
        let videoStreams = "";
        let audioStreams = "";
        for (let i = 0; i < compositionData.clips.length; i++) {
            videoStreams += `[v${i}]`;
            audioStreams += `[a${i}]`;
        }
        // Se concatena "n" clips: se generan salidas etiquetadas "outv" y "outa"
        const concatFilter = `${videoStreams}${audioStreams}concat=n=${compositionData.clips.length}:v=1:a=1[outv][outa]`;
        const fullFilter = [...filterInputs, concatFilter].join(";");

        // Configuración de ffmpeg: se agregan los inputs, se aplica el filtro complejo y se genera el archivo de salida.
        const command = ffmpeg();
        compositionData.clips.forEach((clip: any) => {
            command.input(clip.src);
        });
        command
            .complexFilter(fullFilter, ['outv', 'outa'])
            .outputOptions('-map', '[outv]', '-map', '[outa]')
            .output(outputPath)
            .on('end', () => {
                resolve(`http://example.com/api/videos/${outputFilename}`);
            })
            .on('error', (err: Error) => {
                reject(err);
            })
            .run();
    });
}

/**
 * @swagger
 * /api/videos/compose:
 *   post:
 *     tags: [Video Composition]
 *     summary: Componer video a partir de un JSON de composición
 *     description: >
 *       Recibe un JSON que describe la composición del video (clips con sus tiempos y formato de salida).
 *       El proceso descarga los assets, compone el video utilizando ffmpeg, actualiza el avance en la base de datos
 *       y retorna la URL del video generado.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               clips:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     src:
 *                       type: string
 *                       format: uri
 *                     start:
 *                       type: number
 *                     duration:
 *                       type: number
 *                 example:
 *                   - src: "http://example.com/video1.mp4"
 *                     start: 0
 *                     duration: 5
 *                   - src: "http://example.com/video2.mp4"
 *                     start: 10
 *                     duration: 5
 *               outputFormat:
 *                 type: string
 *                 enum: [mp4, mov]
 *                 default: mp4
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
 *                 videoUrl:
 *                   type: string
 *                 message:
 *                   type: string
 *       400:
 *         description: Error en la composición o validación de datos.
 */
router.post(
    '/api/videos/compose',
    celebrate({
        [Segments.BODY]: videoCompositionSchema
    }),
    async (req: Request, res: Response) => {
        try {
            // Se obtiene la información de composición del request
            const compositionData = req.body;
            // Se genera un ID único para el proceso
            const requestId = crypto.randomBytes(16).toString('hex');

            // Inicializa la tabla de composiciones (si es necesario)
            await initializeVideoCompositionTable();

            // Crea la carpeta para almacenar los assets y el resultado
            const folderPath = path.join(process.cwd(), 'data', 'composeVideo', requestId);
            fs.mkdirSync(folderPath, { recursive: true });

            // Crea el registro inicial en la base de datos con el estado "in_progress"
            await createVideoCompositionRecord({
                id: requestId,
                status: 'in_progress',
                steps: ['assets_downloaded'],
                folder_path: folderPath
            });

            // Se compone el video utilizando los datos proporcionados
            const videoUrl = await composeVideo(compositionData);

            // Actualiza el registro con estado "completed", los pasos ejecutados y la URL del video,
            // además se establece la expiración de la carpeta a 1 hora.
            await updateVideoCompositionProgress(requestId, {
                status: 'completed',
                steps: ['assets_downloaded', 'video_composed'],
                video_url: videoUrl,
                expiration_time: new Date(Date.now() + 60 * 60 * 1000)
            });

            res.status(200).json({
                status: 'success',
                videoUrl,
                message: 'Vídeo generado exitosamente'
            });
        } catch (error: any) {
            res.status(400).json({ error: error.message });
        }
    }
);


export const api_router_video = router;

export default router;
