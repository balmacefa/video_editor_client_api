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

/**
 * Función para limpiar archivos y directorios temporales.
 */
async function cleanupTempDir(tempDir: string) {
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
    console.log(`Cleanup: Directorio temporal ${tempDir} limpiado correctamente.`);
  } catch (cleanupError) {
    console.error(`Cleanup: Error al limpiar el directorio temporal ${tempDir}:`, cleanupError);
  }
}

/**
 * Decodifica la cadena base64 eliminando un posible prefijo tipo "data:tipo/formato;base64,"
 */
function decodeBase64Data(base64Data: string): Buffer {
  const commaIndex = base64Data.indexOf(',');
  if (commaIndex !== -1) {
    return Buffer.from(base64Data.slice(commaIndex + 1), 'base64');
  }
  return Buffer.from(base64Data, 'base64');
}

/**
 * Detecta la extensión del archivo a partir del prefijo data URL.
 * Si no se encuentra, retorna la extensión por defecto indicada.
 */
function getFileExtension(base64Data: string, defaultExt: string): string {
  const regex = /^data:(.+?)\/(.+?);base64,/;
  const match = base64Data.match(regex);
  if (match && match[2]) {
    const ext = match[2].toLowerCase();
    // Mapea solo algunos formatos conocidos; de lo contrario se usa el default
    if (['mp4', 'webm', 'mkv'].includes(ext)) {
      return `.${ext}`;
    }
    if (['mpeg', 'mp3'].includes(ext)) {
      return '.mp3';
    }
  }
  return defaultExt;
}

/**
 * Crea un video por defecto (negro de 5 segundos) y retorna su ruta.
 */
async function createDefaultVideo(tempDir: string, processId: string): Promise<string> {
  const defaultVideoPath = path.join(tempDir, 'default_video.mp4');
  return new Promise<string>((resolve, reject) => {
    ffmpeg()
      .input('color=c=black:s=640x480:d=5')
      .inputFormat('lavfi')
      .outputOptions(['-pix_fmt', 'yuv420p'])
      .on('start', (commandLine) => {
        console.log(`[Process ${processId}] [DefaultVideo] Inicio de creación. CMD: ${commandLine}`);
      })
      .on('progress', (progress) => {
        console.log(`[Process ${processId}] [DefaultVideo] Progreso: ${progress.percent?.toFixed(2) || 0}%`);
      })
      .on('error', (err) => {
        console.error(`[Process ${processId}] [DefaultVideo] Error creando video por defecto: ${err.message}`);
        reject(new Error(`[DefaultVideo] ${err.message}`));
      })
      .on('end', () => {
        console.log(`[Process ${processId}] [DefaultVideo] Video por defecto creado en ${defaultVideoPath}`);
        resolve(defaultVideoPath);
      })
      .save(defaultVideoPath);
  });
}

/**
 * Procesa un segmento de tipo 'video': decodifica el base64, determina la extensión y escribe el archivo.
 * Retorna la ruta del video generado.
 */
async function processVideoSegment(segment: any, tempDir: string, processId: string): Promise<string> {
  try {
    const videoBuffer = decodeBase64Data(segment.base_64);
    const videoExt = getFileExtension(segment.base_64, '.mp4');
    const tempVideoFile = path.join(tempDir, `video_${uuidv4()}${videoExt}`);
    await writeFileAsync(tempVideoFile, videoBuffer);
    console.log(`[Process ${processId}] [VideoSegment] Archivo de video creado: ${tempVideoFile}`);
    return tempVideoFile;
  } catch (error: any) {
    console.error(`[Process ${processId}] [VideoSegment] Error procesando segmento de video: ${error.message}`);
    throw new Error(`[VideoSegment] ${error.message}`);
  }
}

/**
 * Procesa un segmento de tipo 'tts': decodifica el audio, lo guarda y utiliza FFmpeg para unirlo con el video actual.
 * Retorna la ruta del segmento generado.
 */
async function processTTSSegment(
  segment: any,
  currentVideoPath: string,
  tempDir: string,
  processId: string,
  segmentIndex: number
): Promise<string> {
  try {
    const audioBuffer = decodeBase64Data(segment.base_64);
    const audioExt = getFileExtension(segment.base_64, '.mp3');
    const tempAudioFile = path.join(tempDir, `audio_${uuidv4()}${audioExt}`);
    await writeFileAsync(tempAudioFile, audioBuffer);
    console.log(`[Process ${processId}] [TTSSegment] Audio TTS guardado: ${tempAudioFile}`);

    const outputSegmentFile = path.join(tempDir, `segment_${segmentIndex}.mp4`);
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout en la creación del segmento TTS'));
      }, 60000);

      ffmpeg()
        .input(currentVideoPath)
        .input(tempAudioFile)
        .outputOptions('-shortest')
        .on('start', (commandLine) => {
          console.log(`[Process ${processId}] [TTSSegment] Inicio de creación del segmento. CMD: ${commandLine}`);
        })
        .on('progress', (progress) => {
          console.log(
            `[Process ${processId}] [TTSSegment] Progreso: ${progress.percent?.toFixed(2) || 0}% - Segmento: ${outputSegmentFile}`
          );
        })
        .on('error', (err) => {
          clearTimeout(timeout);
          console.error(`[Process ${processId}] [TTSSegment] Error en FFmpeg al crear segmento TTS: ${err.message}`);
          reject(new Error(`[TTSSegment] ${err.message}`));
        })
        .on('end', () => {
          clearTimeout(timeout);
          console.log(`[Process ${processId}] [TTSSegment] Segmento creado: ${outputSegmentFile}`);
          resolve();
        })
        .save(outputSegmentFile);
    });
    return outputSegmentFile;
  } catch (error: any) {
    console.error(`[Process ${processId}] [TTSSegment] Error procesando segmento TTS: ${error.message}`);
    throw new Error(`[TTSSegment] ${error.message}`);
  }
}

/**
 * Concatena los segmentos generados mediante FFmpeg usando un archivo de lista.
 * Retorna la ruta del video final.
 */
async function concatenateSegments(
  segmentFiles: string[],
  tempDir: string,
  processId: string
): Promise<string> {
  const concatListFile = path.join(tempDir, 'concat_list.txt');
  const concatFileContent = segmentFiles.map((file) => `file '${file}'`).join('\n');
  await writeFileAsync(concatListFile, concatFileContent);
  console.log(`[Process ${processId}] [Concat] Archivo de lista creado: ${concatListFile}`);

  const finalOutputFile = path.join(tempDir, `final_output_${uuidv4()}.mp4`);
  return new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timeout durante la concatenación de segmentos'));
    }, 120000);

    ffmpeg()
      .input(concatListFile)
      .inputOptions(['-f', 'concat', '-safe', '0'])
      .outputOptions(['-c', 'copy'])
      .on('start', (commandLine) => {
        console.log(`[Process ${processId}] [Concat] Inicio de concatenación. CMD: ${commandLine}`);
      })
      .on('progress', (progress) => {
        console.log(`[Process ${processId}] [Concat] Progreso: ${progress.percent?.toFixed(2) || 0}%`);
      })
      .on('error', (err) => {
        clearTimeout(timeout);
        console.error(`[Process ${processId}] [Concat] Error en concatenación: ${err.message}`);
        reject(new Error(`[Concat] ${err.message}`));
      })
      .on('end', () => {
        clearTimeout(timeout);
        console.log(`[Process ${processId}] [Concat] Video final generado: ${finalOutputFile}`);
        resolve(finalOutputFile);
      })
      .save(finalOutputFile);
  });
}

router.post(
  '/single_api',
  apiKeyMiddleware,
  celebrate({ [Segments.BODY]: sequentialVideoSchema }),
  async (req: Request, res: Response): Promise<void> => {
    const processId = uuidv4();
    const tempDir = path.join(process.cwd(), 'data', 'temp_single_api', processId);

    console.log(`[Process ${processId}] Inicio de request`);
    try {
      const { type, data } = req.body;
      if (type !== 'compile_sequential_video') {
        console.error(`[Process ${processId}] Tipo de request no soportado: ${type}`);
        res.status(400).json({ error: 'Unsupported type' });
        return;
      }

      // Crear directorio temporal para el proceso
      if (!fs.existsSync(tempDir)) {
        await mkdirAsync(tempDir, { recursive: true });
        console.log(`[Process ${processId}] Directorio temporal creado: ${tempDir}`);
      }

      // Crear video por defecto
      let currentVideoPath = await createDefaultVideo(tempDir, processId);

      // Ordenar segmentos por id
      data.sort((a: any, b: any) => a.id - b.id);
      console.log(`[Process ${processId}] Segments ordenados por ID`);

      const segmentFiles: string[] = [];
      let segmentIndex = 0;

      // Procesar cada segmento
      for (const segment of data) {
        if (segment.type === 'video') {
          console.log(`[Process ${processId}] Procesando segmento de tipo VIDEO con id: ${segment.id}`);
          currentVideoPath = await processVideoSegment(segment, tempDir, processId);
        } else if (segment.type === 'tts') {
          console.log(`[Process ${processId}] Procesando segmento de tipo TTS con id: ${segment.id}`);
          const segmentFile = await processTTSSegment(segment, currentVideoPath, tempDir, processId, segmentIndex);
          segmentFiles.push(segmentFile);
          segmentIndex++;
        } else {
          console.warn(`[Process ${processId}] Segmento desconocido: ${segment.type}`);
        }
      }

      if (segmentFiles.length === 0) {
        console.error(`[Process ${processId}] No se generaron segmentos TTS para la concatenación`);
        res.status(400).json({ error: 'No se generaron segmentos de audio para el procesamiento.' });
        return;
      }

      // Concatenar segmentos para generar el video final
      const finalOutputFile = await concatenateSegments(segmentFiles, tempDir, processId);
      const finalVideoBuffer = await readFileAsync(finalOutputFile);
      res.set('Content-Type', 'video/mp4');
      res.send(finalVideoBuffer);
      console.log(`[Process ${processId}] Request completado exitosamente.`);
    } catch (error: any) {
      console.error(`[Process ${processId}] Error en el endpoint /single_api: ${error.message}`);
      res.status(500).json({ error: error.message || 'Internal server error' });
    } finally {
      // Siempre limpiar el directorio temporal, independientemente del resultado
      await cleanupTempDir(tempDir);
      console.log(`[Process ${processId}] Cleanup finalizado.`);
    }
  }
);

export default router;
export const single_api = router;
