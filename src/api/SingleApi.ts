import { Request, Response, Router } from 'express';
import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import { v4 as uuidv4 } from 'uuid';
import { celebrate, Joi, Segments } from 'celebrate';
import { apiKeyMiddleware } from './apiKeyMiddleware';
import { promisify } from 'util';

ffmpeg.setFfmpegPath(ffmpegStatic);

const router = Router();

// Esquema de validación
const sequentialVideoSchema = Joi.object({
  type: Joi.string().valid('compile_sequential_video').required(),
  data: Joi.array()
    .items(
      Joi.object({
        base_64: Joi.string().required(),
        type: Joi.string().valid('video', 'tts').required(),
        content: Joi.string().optional(),
        id: Joi.number().required(),
      })
    )
    .min(1)
    .required(),
});

const writeFileAsync = promisify(fs.writeFile);
const readFileAsync = promisify(fs.readFile);
const mkdirAsync = promisify(fs.mkdir);

// Función para limpiar archivos y directorios temporales
async function cleanupTempDir(tempDir: string) {
  try {
    // Aquí se puede usar una librería para remover recursivamente el directorio
    fs.rmSync(tempDir, { recursive: true, force: true });
    console.log(`Directorio temporal ${tempDir} limpiado correctamente.`);
  } catch (cleanupError) {
    console.error(`Error al limpiar el directorio temporal ${tempDir}:`, cleanupError);
  }
}

router.post(
  '/single_api',
  apiKeyMiddleware,
  celebrate({ [Segments.BODY]: sequentialVideoSchema }),
  async (req: Request, res: Response): Promise<void> => {
    const processId = uuidv4();
    const tempDir = path.join(process.cwd(), 'data', 'temp_single_api', processId);

    try {
      const { type, data } = req.body;
      if (type !== 'compile_sequential_video') {
        res.status(400).json({ error: 'Unsupported type' });
        return; 
      }

      // Crear directorio temporal para el proceso
      if (!fs.existsSync(tempDir)) {
        await mkdirAsync(tempDir, { recursive: true });
        console.log(`[Process ${processId}] Directorio temporal creado: ${tempDir}`);
      }

      // Ordenar segmentos por id
      data.sort((a: any, b: any) => a.id - b.id);

      // Verificar y definir video activo
      let currentVideoPath = path.join(process.cwd(), 'data', 'default_video.mp4');
      if (!fs.existsSync(currentVideoPath)) {
        throw new Error('Default video not found');
      }
      console.log(`[Process ${processId}] Video activo inicial: ${currentVideoPath}`);

      const segmentFiles: string[] = [];
      let segmentIndex = 0;

      // Procesar cada segmento
      for (const segment of data) {
        if (segment.type === 'video') {
          try {
            const videoBuffer = Buffer.from(segment.base_64, 'base64');
            const tempVideoFile = path.join(tempDir, `video_${uuidv4()}.mp4`);
            await writeFileAsync(tempVideoFile, videoBuffer);
            currentVideoPath = tempVideoFile;
            console.log(`[Process ${processId}] Video actualizado: ${currentVideoPath}`);
          } catch (videoError) {
            console.error(`[Process ${processId}] Error procesando segmento de video: ${videoError.message}`);
            throw videoError;
          }
        } else if (segment.type === 'tts') {
          try {
            const audioBuffer = Buffer.from(segment.base_64, 'base64');
            const tempAudioFile = path.join(tempDir, `audio_${uuidv4()}.mp3`);
            await writeFileAsync(tempAudioFile, audioBuffer);
            console.log(`[Process ${processId}] Audio TTS guardado: ${tempAudioFile}`);

            const outputSegmentFile = path.join(tempDir, `segment_${segmentIndex++}.mp4`);
            await new Promise<void>((resolve, reject) => {
              // Agregar timeout en FFmpeg para evitar procesos colgados
              const command = ffmpeg()
                .input(currentVideoPath)
                .input(tempAudioFile)
                .outputOptions('-shortest')
                .on('start', () => {
                  console.log(`[Process ${processId}] Iniciando creación del segmento: ${outputSegmentFile}`);
                })
                .on('error', (err) => {
                  console.error(`[Process ${processId}] Error en FFmpeg: ${err.message}`);
                  reject(err);
                })
                .on('end', () => {
                  console.log(`[Process ${processId}] Segmento creado: ${outputSegmentFile}`);
                  resolve();
                })
                .save(outputSegmentFile);

              // Timeout de 60 segundos para cada segmento
              setTimeout(() => {
                reject(new Error('Timeout en la creación del segmento'));
              }, 60000);
            });
            segmentFiles.push(outputSegmentFile);
          } catch (ttsError) {
            console.error(`[Process ${processId}] Error procesando segmento TTS: ${ttsError.message}`);
            throw ttsError;
          }
        } else {
          console.warn(`[Process ${processId}] Segmento desconocido: ${segment.type}`);
        }
      }

      if (segmentFiles.length === 0) {
        res.status(400).json({ error: 'No se generaron segmentos de audio para el procesamiento.' });
        return; 
      }

      // Crear archivo de lista para concatenación
      const concatListFile = path.join(tempDir, 'concat_list.txt');
      const concatFileContent = segmentFiles.map((file) => `file '${file}'`).join('\n');
      await writeFileAsync(concatListFile, concatFileContent);
      console.log(`[Process ${processId}] Archivo de lista creado: ${concatListFile}`);

      // Generar video final concatenando segmentos
      const finalOutputFile = path.join(tempDir, `final_output_${uuidv4()}.mp4`);
      await new Promise<void>((resolve, reject) => {
        const command = ffmpeg()
          .input(concatListFile)
          .inputOptions(['-f', 'concat', '-safe', '0'])
          .outputOptions(['-c', 'copy'])
          .on('start', () => {
            console.log(`[Process ${processId}] Iniciando concatenación...`);
          })
          .on('error', (err) => {
            console.error(`[Process ${processId}] Error en concatenación: ${err.message}`);
            reject(err);
          })
          .on('end', () => {
            console.log(`[Process ${processId}] Video final generado: ${finalOutputFile}`);
            resolve();
          })
          .save(finalOutputFile);

        // Timeout para la concatenación
        setTimeout(() => {
          reject(new Error('Timeout durante la concatenación de segmentos'));
        }, 120000);
      });

      const finalVideoBuffer = await readFileAsync(finalOutputFile);
      res.set('Content-Type', 'video/mp4');
      res.send(finalVideoBuffer);
      console.log(`[Process ${processId}] Proceso completado exitosamente.`);
    } catch (error: any) {
      console.error(`[Process ${processId}] Error en el endpoint /single_api:`, error);
      res.status(500).json({ error: error.message || 'Internal server error' });
    } finally {
      // Siempre limpiar el directorio temporal, independientemente del resultado
      await cleanupTempDir(tempDir);
    }
  }
);

export default router;
export const single_api = router;
