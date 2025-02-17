// ./src/api/CompileSequenceAPI.ts
import { Request, Response, Router } from 'express';
import { celebrate, Joi, Segments } from 'celebrate';

const router = Router();

/**
 * @swagger
 * components:
 *   schemas:
 *     Resource:
 *       type: object
 *       required:
 *         - resource_id
 *         - type
 *         - content
 *       properties:
 *         resource_id:
 *           type: string
 *           description: Identificador único del recurso.
 *         type:
 *           type: string
 *           enum: [audio, tts, video]
 *           description: Tipo de recurso.
 *         content:
 *           type: string
 *           description: Contenido o descripción del recurso.
 *     CompileSequenceRequest:
 *       type: object
 *       required:
 *         - resources
 *         - primeros
 *       properties:
 *         resources:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/Resource'
 *         primeros:
 *           type: array
 *           items:
 *             type: string
 *           description: Arreglo de resource_id que define el orden de compilación.
 *     CompileSequenceResponse:
 *       type: object
 *       properties:
 *         status:
 *           type: string
 *         compiledSequence:
 *           type: string
 *         message:
 *           type: string
 */

/**
 * @swagger
 * /api/compilar-secuencia:
 *   post:
 *     summary: Compilar una secuencia de recursos multimedia
 *     tags: [Compilación]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CompileSequenceRequest'
 *           example:
 *             resources:
 *               - resource_id: "r1"
 *                 type: "audio"
 *                 content: "Intro musical breve y enérgica"
 *               - resource_id: "r2"
 *                 type: "tts"
 *                 content: "¡Bienvenidos a [Nombre del Podcast]! Soy [Tu Nombre]..."
 *               - resource_id: "r3"
 *                 type: "video"
 *                 content: "Fondo con el logo del podcast y una imagen de un planeta girando."
 *             primeros:
 *               - "r1"
 *               - "r2"
 *               - "r3"
 *     responses:
 *       200:
 *         description: Secuencia compilada correctamente.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CompileSequenceResponse'
 *       400:
 *         description: Error de validación, algún resource_id de "primeros" no existe en resources.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *       500:
 *         description: Error interno al compilar la secuencia.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */

// Esquema para validar el payload del endpoint /api/compilar-secuencia
const compileSequenceSchema = Joi.object({
  resources: Joi.array().items(
    Joi.object({
      resource_id: Joi.string().required(),
      type: Joi.string().valid('audio', 'tts', 'video').required(),
      content: Joi.string().required(),
    })
  ).min(1).required(),
  primeros: Joi.array().items(Joi.string()).min(1).required()
});

router.post(
  '/api/compilar-secuencia',
  celebrate({ [Segments.BODY]: compileSequenceSchema }),
  async (req: Request, res: Response) => {
    try {
      const { resources, primeros } = req.body as {
        resources: Array<{ resource_id: string; type: string; content: string }>;
        primeros: string[];
      };

      // Validamos que cada resource_id en "primeros" exista en el arreglo "resources"
      const resourceIds = resources.map(r => r.resource_id);
      const missingIds = primeros.filter(id => !resourceIds.includes(id));
      if (missingIds.length > 0) {
        return res.status(400).json({
          error: `Los siguientes resource_id no se encuentran en resources: ${missingIds.join(', ')}`
        });
      }

      // Ejemplo de compilación: concatenamos el contenido en el orden indicado en "primeros".
      // Aquí se pueden integrar procesos TTS, efectos o composición multimedia según la necesidad.
      const compiledSequence = primeros.map(id => {
        const resource = resources.find(r => r.resource_id === id)!;
        return `[${resource.type.toUpperCase()}] ${resource.content}`;
      }).join('\n\n');

      return res.status(200).json({
        status: 'success',
        compiledSequence,
        message: 'Secuencia compilada correctamente.'
      });
    } catch (error: any) {
      console.error('Error en el endpoint /api/compilar-secuencia:', error);
      return res.status(500).json({
        error: 'Error interno al compilar la secuencia.'
      });
    }
  }
);

export const api_router_compileSequence = router;
export default router;
