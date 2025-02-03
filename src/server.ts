import cors from 'cors';
import express, { NextFunction, Request, Response } from 'express';
import { readFileSync } from "fs";
import path from 'path';
import swaggerJSDoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import { api_router_audio } from './api/AudioAPI';
import { api_router_video } from './api/VideoAPI';
import { ENV } from './server/global_variables';



const executionPath = process.cwd();
const packageJsonPath = path.join(executionPath, 'package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));

const swaggerOptions: swaggerJSDoc.Options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'Multimedia Processing API',
            version: packageJson.version,
            description: 'API profesional para conversión y composición multimedia',
        },
        servers: [{ url: ENV.PROD_HOST }],
        tags: [
        ],
    },
    apis: ['./src/**/*'], // Path to the API routes
};

/**
 * @swagger
 * components:
 *   securitySchemes:
 *     BearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 */

/**
 * Middleware to validate API Key using the Authorization header.
 * Expected format: Authorization: Bearer <API_KEY>
 */
export const apiKeyMiddleware = (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.header('Authorization');

    if (!authHeader) {
        res.status(401).json({ error: 'Authorization header missing' });
        return;
    }

    const parts = authHeader.split(' ');

    if (parts.length !== 2 || parts[0] !== 'Bearer') {
        res.status(400).json({ error: 'Invalid Authorization header format. Format should be "Bearer <API_KEY>"' });
        return;
    }

    const apiKey = parts[1];

    if (!ENV.API_KEYS.includes(apiKey)) {
        res.status(403).json({ error: 'Invalid API key' });
        return;
    }

    next();
};



export const createApp = async () => {
    const app = express();

    // Middleware
    app.use(cors());
    // Middleware
    app.use(cors());
    // Aumentamos el límite de la petición para JSON y urlencoded
    app.use(express.json({ limit: '50mb' }));
    app.use(express.urlencoded({ limit: '50mb', extended: true }));




    // Swagger setup
    const swaggerSpec = swaggerJSDoc(swaggerOptions);
    app.use('/swagger', swaggerUi.serve, swaggerUi.setup(swaggerSpec));


    app.get('/', (req, res) => {
        res.send(
            `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Multimedia Processing API</title>
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.1/font/bootstrap-icons.css">
    </head>
    <body class="bg-light">
        <div class="container py-5">
            <div class="text-center mb-5">
                <h1 class="display-4 mb-3 fw-bold text-primary">
                    <i class="bi bi-file-earmark-play"></i> Multimedia Processing API
                </h1>
                <p class="lead fs-4">Versión: ${packageJson.version}</p>
                <p class="text-muted">API profesional para conversión y composición multimedia</p>
            </div>

            <div class="row g-4">
                <!-- Sección Audio -->
                <div class="col-md-6">
                    <div class="card h-100 shadow-sm">
                        <div class="card-header bg-primary text-white">
                            <h3 class="mb-0"><i class="bi bi-file-earmark-music"></i> Audio Processing</h3>
                        </div>
                        <div class="card-body">
                            <h5 class="mb-3">Conversión de Formatos</h5>
                            <ul class="list-unstyled ms-4">
                                <li><i class="bi bi-arrow-repeat"></i> Formatos soportados: MP3, WAV, AAC, FLAC</li>
                                <li><i class="bi bi-file-arrow-down"></i> Entrada/Salida en Base64 o Binario</li>
                                <li><i class="bi bi-lightning-charge"></i> Conversión en tiempo real</li>
                                <li><i class="bi bi-shield-check"></i> Validación de formatos</li>
                            </ul>
                        </div>
                    </div>
                </div>

                <!-- Sección Video -->
                <div class="col-md-6">
                    <div class="card h-100 shadow-sm">
                        <div class="card-header bg-success text-white">
                            <h3 class="mb-0"><i class="bi bi-film"></i> Video Composition</h3>
                        </div>
                        <div class="card-body">
                            <h5 class="mb-3">Edición Programática</h5>
                            <ul class="list-unstyled ms-4">
                                <li><i class="bi bi-puzzle"></i> Composición mediante JSON</li>
                                <li><i class="bi bi-scissors"></i> Recorte y concatenación</li>
                                <li><i class="bi bi-sliders"></i> Transiciones y efectos</li>
                                <li><i class="bi bi-gear-wide-connected"></i> Ajuste de resolución</li>
                                <li><i class="bi bi-layers"></i> Superposición de elementos</li>
                            </ul>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Sección Características Generales -->
            <div class="row mt-4 g-4">
                <div class="col-md-4">
                    <div class="card h-100 shadow-sm">
                        <div class="card-header bg-info text-white">
                            <h5><i class="bi bi-cpu"></i> Core Features</h5>
                        </div>
                        <div class="card-body">
                            <ul class="list-unstyled">
                                <li><i class="bi bi-check2-circle"></i> RESTful Design</li>
                                <li><i class="bi bi-clock-history"></i> Procesamiento Asincrónico</li>
                                <li><i class="bi bi-shield-lock"></i> Autenticación JWT</li>
                            </ul>
                        </div>
                    </div>
                </div>

                <div class="col-md-4">
                    <div class="card h-100 shadow-sm">
                        <div class="card-header bg-warning text-dark">
                            <h5><i class="bi bi-input-cursor"></i> Input/Output</h5>
                        </div>
                        <div class="card-body">
                            <ul class="list-unstyled">
                                <li><i class="bi bi-file-code"></i> JSON API</li>
                                <li><i class="bi bi-file-binary"></i> Soporte Base64</li>
                                <li><i class="bi bi-database"></i> Almacenamiento temporal</li>
                            </ul>
                        </div>
                    </div>
                </div>

                <div class="col-md-4">
                    <div class="card h-100 shadow-sm">
                        <div class="card-header bg-danger text-white">
                            <h5><i class="bi bi-tools"></i> Tecnologías</h5>
                        </div>
                        <div class="card-body">
                            <ul class="list-unstyled">
                                <li><i class="bi bi-code-square"></i> Node.js/Express</li>
                                <li><i class="bi bi-gear"></i> FFmpeg Integration</li>
                                <li><i class="bi bi-box-seam"></i> Docker Support</li>
                            </ul>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Documentación -->
            <div class="text-center mt-5">
                <div class="card shadow-sm">
                    <div class="card-body">
                        <h3 class="mb-4"><i class="bi bi-book"></i> API Documentation</h3>
                        <p class="text-muted mb-4">Explore endpoints interactivos y especificaciones técnicas</p>
                        <a href="/swagger" class="btn btn-lg btn-dark">
                            <i class="bi bi-file-earmark-code"></i> Swagger UI
                        </a>
                    </div>
                </div>
            </div>
        </div>

        <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
    </body>
    </html>
    `);
    });
    // Define routes
    // defineRoutes(app);
    api_router_audio.use(apiKeyMiddleware);
    api_router_video.use(apiKeyMiddleware);


    app.use('/', api_router_audio);
    app.use('/', api_router_video);
    // api_router_audio(app)

    return app;
};

export const startServer = async () => {
    const app = await createApp();
    const server = app.listen(ENV.PORT, () => {
        console.log(`Server running on http://${ENV.HOST}:${ENV.PORT}`);
        ENV.server_isReady = true;
        ENV.server_isHealthy = true;
    });

    return server;
};