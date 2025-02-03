import { celebrate, Joi, Segments } from 'celebrate';
import { Request, Response, Router } from 'express';
import ffmpegStatic from 'ffmpeg-static';
import ffmpeg from 'fluent-ffmpeg';
import { PassThrough } from 'stream';
import { WritableStreamBuffer } from 'stream-buffers';

ffmpeg.setFfmpegPath(ffmpegStatic);

const router = Router();

/**
 * Limpia el prefijo Data URL de una cadena base64.
 * @param base64Data Cadena base64 (posiblemente con prefijo).
 * @returns Cadena base64 sin prefijo.
 */
function cleanBase64Data(base64Data: string): string {
    const regex = /^data:.*;base64,/;
    return base64Data.replace(regex, '');
}

/**
 * Función genérica para convertir audio de cualquier formato a otro.
 * @param inputMimeType Mime type de la entrada.
 * @param base64Data Cadena base64 del audio de entrada.
 * @param outputFormat Formato de salida deseado (por ejemplo, "ogg", "mp3", "wav", etc.)
 * @returns Promesa que resuelve con un Buffer con la data convertida.
 */
export async function convertAudio(
    inputMimeType: string,
    base64Data: string,
    outputFormat: string
): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const cleanedBase64 = cleanBase64Data(base64Data);
        const inputBuffer = Buffer.from(cleanedBase64, 'base64');
        if (inputBuffer.length === 0) {
            return reject(new Error("El buffer de entrada está vacío. Verifica la cadena base64."));
        }
        const inputStream = new PassThrough();
        inputStream.end(inputBuffer);

        const outputBufferStream = new WritableStreamBuffer();

        const command = ffmpeg(inputStream)
            .format(outputFormat);

        command
            .on('error', (err) => {
                reject(new Error(`Error en la conversión con FFmpeg: ${err.message}`));
            })
            .on('end', () => {
                const outputBuffer = outputBufferStream.getContents();
                if (!outputBuffer) {
                    return reject(new Error('No se obtuvo resultado de la conversión.'));
                }
                resolve(outputBuffer);
            })
            .pipe(outputBufferStream, { end: true });
    });
}

/**
 * Esquema Joi para validar la petición de conversión de audio.
 * Se acepta:
 *  - inputMimeType: mimetype del audio de entrada.
 *  - audioBase64: cadena base64 del audio.
 *  - outputFormat: formato de salida deseado.
 *  - returnType: "base64" o "binary"
 */
const audioConversionSchema = Joi.object({
    inputMimeType: Joi.string().required(),
    audioBase64: Joi.string().required(),
    outputFormat: Joi.string().required(),
    returnType: Joi.string().valid("base64", "binary").required()
});


/**
 * @swagger
 * /api/audio/convert-audio:
 *   post:
 *     security:
 *       - BearerAuth: []
 *     tags: [/api/audio]
 *     summary: Convierte un audio de un formato a otro
 *     description: Recibe un audio en base64, lo convierte al formato especificado y retorna el resultado
 *       ya sea en base64 o en data binaria, según se especifique en "returnType".
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               inputMimeType:
 *                 type: string
 *                 description: Tipo MIME del audio de entrada.
 *                 example: "audio/wav"
 *               audioBase64:
 *                 type: string
 *                 description: Audio codificado en base64.
 *                 example: "UklGRigAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA="
 *               outputFormat:
 *                 type: string
 *                 description: Formato de salida deseado para el audio.
 *                 example: "mp3"
 *               returnType:
 *                 type: string
 *                 description: Indica si se retorna el audio en base64 o en data binaria.
 *                 enum: [base64, binary]
 *                 example: "base64"
 *     responses:
 *       200:
 *         description: Audio convertido exitosamente.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "success"
 *                 convertedAudioBase64:
 *                   type: string
 *                   description: Audio convertido en base64 (si se eligió "base64").
 *                 message:
 *                   type: string
 *                   description: Mensaje de confirmación.
 *           application/octet-stream:
 *             schema:
 *               type: string
 *               format: binary
 * 
 */
router.post(
    '/api/audio/convert-audio',
    celebrate({
        [Segments.BODY]: audioConversionSchema
    }),
    async (req: Request, res: Response) => {
        try {
            const { inputMimeType, audioBase64, outputFormat, returnType } = req.body;
            const convertedBuffer = await convertAudio(inputMimeType, audioBase64, outputFormat);

            if (returnType === "base64") {
                const convertedBase64 = convertedBuffer.toString('base64');
                res.status(200).json({
                    status: "success",
                    convertedAudioBase64: convertedBase64,
                    message: `Audio convertido a ${outputFormat} exitosamente`
                });
            } else {
                // Si se solicita binario, se envía el buffer directamente.
                res.set('Content-Type', `audio/${outputFormat}`);
                res.status(200).send(convertedBuffer);
            }
        } catch (error: any) {
            res.status(400).json({ error: error.message });
        }
    }
);

export const api_router_audio = router;
export default router;
