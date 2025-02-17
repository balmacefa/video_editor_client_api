/**
 * @swagger
 * /single_api:
 *   post:
 *     summary: Compila un video secuencial
 *     description: |
 *       Este endpoint recibe un objeto JSON con el tipo "compile_sequential_video" y un array de segmentos. 
 *       Cada segmento debe incluir:
 *         - **base_64**: Cadena codificada en base64 del video o audio.
 *         - **type**: Indica el tipo de segmento, que puede ser:
 *             - **video**: Actualiza el video activo que se usará en los siguientes segmentos.
 *             - **tts**: Representa audio (TTS) que se sobrepone al video activo.
 *         - **content**: Texto descriptivo o transcripción, en caso de ser TTS.
 *         - **id**: Número que determina el orden de los segmentos.
 *       El proceso consiste en:
 *         1. Procesar los segmentos en orden (según el campo **id**).
 *         2. Actualizar el video activo al encontrar un segmento de tipo "video".
 *         3. Combinar el audio TTS del segmento con el video activo en ese momento.
 *         4. Concatenar todos los segmentos generados en un único archivo de video.
 *     tags:
 *       - Single API
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       description: Objeto JSON que contiene el tipo y el array de segmentos a procesar.
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [compile_sequential_video]
 *                 example: compile_sequential_video
 *               data:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     base_64:
 *                       type: string
 *                       description: Cadena codificada en base64 del recurso (video o audio).
 *                       example: "PIxAAAAANIAAAAAExBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVV..."
 *                     type:
 *                       type: string
 *                       enum: [video, tts]
 *                       description: Tipo de recurso. "video" para actualizar el video activo, "tts" para audio.
 *                       example: tts
 *                     content:
 *                       type: string
 *                       description: Texto o contenido asociado, por ejemplo, para TTS.
 *                       example: "¡Bienvenidos a [Nombre del Podcast]! Soy [Tu Nombre]..."
 *                     id:
 *                       type: number
 *                       description: Identificador numérico que determina el orden del segmento.
 *                       example: 0
 *             required:
 *               - type
 *               - data
 *     responses:
 *       200:
 *         description: Video compilado exitosamente.
 *         content:
 *           video/mp4:
 *             schema:
 *               type: string
 *               format: binary
 *       400:
 *         description: Solicitud incorrecta, por ejemplo, falta de datos o formato inválido.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "The data field must be a non-empty array"
 *       500:
 *         description: Error interno en el servidor.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Internal server error"
 */

import { Request, Response, Router } from 'express';
import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import { v4 as uuidv4 } from 'uuid';
import { apiKeyMiddleware } from './apiKeyMiddleware';

ffmpeg.setFfmpegPath(ffmpegStatic);

const router = Router();

router.post('/single_api', apiKeyMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const { type, data } = req.body;

    if (type !== 'compile_sequential_video') {
      res.status(400).json({ error: 'Unsupported type' });
      return;
    }

    if (!Array.isArray(data) || data.length === 0) {
      res.status(400).json({ error: 'The data field must be a non-empty array' });
      return;
    }

    // Ordenar los segmentos por el campo "id" para garantizar el orden correcto.
    data.sort((a: any, b: any) => a.id - b.id);

    // Crear un directorio temporal para almacenar los archivos generados.
    const tempDir = path.join(process.cwd(), 'data', 'temp_single_api');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Definir un video activo por defecto (debe existir en la ruta indicada).
    let currentVideoPath = path.join(process.cwd(), 'data', 'default_video.mp4');

    // Arreglo para almacenar los segmentos generados (video + audio tts).
    const segmentFiles: string[] = [];
    let segmentIndex = 0;

    // Procesar cada segmento del arreglo recibido.
    for (const segment of data) {
      if (segment.type === 'video') {
        // Decodificar el video en base64 y guardarlo en un archivo temporal.
        const videoBuffer = Buffer.from(segment.base_64, 'base64');
        const tempVideoFile = path.join(tempDir, `video_${uuidv4()}.mp4`);
        fs.writeFileSync(tempVideoFile, videoBuffer);
        currentVideoPath = tempVideoFile;
      } else if (segment.type === 'tts') {
        // Decodificar el audio (tts) en base64 y guardarlo en un archivo temporal.
        const audioBuffer = Buffer.from(segment.base_64, 'base64');
        const tempAudioFile = path.join(tempDir, `audio_${uuidv4()}.mp3`);
        fs.writeFileSync(tempAudioFile, audioBuffer);

        // Combinar el video activo y el audio tts en un segmento usando FFmpeg.
        const outputSegmentFile = path.join(tempDir, `segment_${segmentIndex++}.mp4`);
        await new Promise<void>((resolve, reject) => {
          ffmpeg()
            .input(currentVideoPath)
            .input(tempAudioFile)
            .outputOptions('-shortest')
            .on('error', (err) => {
              console.error('Error creating segment:', err);
              reject(err);
            })
            .on('end', () => {
              console.log('Segment created:', outputSegmentFile);
              resolve();
            })
            .save(outputSegmentFile);
        });
        segmentFiles.push(outputSegmentFile);
      } else {
        console.warn(`Unrecognized segment type: ${segment.type}`);
      }
    }

    if (segmentFiles.length === 0) {
      res.status(400).json({ error: 'No audio segments were generated for processing.' });
      return;
    }

    // Crear un archivo de lista para FFmpeg que concatene todos los segmentos.
    const concatListFile = path.join(tempDir, 'concat_list.txt');
    const concatFileContent = segmentFiles.map(file => `file '${file}'`).join('\n');
    fs.writeFileSync(concatListFile, concatFileContent);

    // Generar el archivo de video final concatenando los segmentos.
    const finalOutputFile = path.join(tempDir, `final_output_${uuidv4()}.mp4`);
    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(concatListFile)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .outputOptions(['-c', 'copy'])
        .on('error', (err) => {
          console.error('Error during concatenation:', err);
          reject(err);
        })
        .on('end', () => {
          console.log('Final video generated:', finalOutputFile);
          resolve();
        })
        .save(finalOutputFile);
    });

    // Leer el archivo final y retornar el video como respuesta binaria.
    const finalVideoBuffer = fs.readFileSync(finalOutputFile);
    res.set('Content-Type', 'video/mp4');
    res.send(finalVideoBuffer);

    // Opcional: implementar limpieza de archivos temporales.
  } catch (error: any) {
    console.error('Error in /single_api endpoint:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export default router;
export const single_api = router;
