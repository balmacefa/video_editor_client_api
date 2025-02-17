// src/api/SingleApi.ts
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

