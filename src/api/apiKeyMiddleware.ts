import { NextFunction, Request, Response } from 'express';
import { ENV } from '../server/global_variables';

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
