import * as fs from 'fs';
import KnexDatabase from "../server/KnexDatabase";


// videoDataRouter.ts
const db = KnexDatabase;

async function cleanExpiredVideos(): Promise<void> {
    try {
        console.log('[Cleanup] Iniciando limpieza de videos expirados...');

        // 1. Obtener registros con expiración pasada
        const expiredRecords = await db('video_compositions')
            .where('expiration_time', '<', db.fn.now())
            .whereNotNull('video_path');

        if (!expiredRecords.length) {
            console.log('[Cleanup] No hay videos expirados para limpiar.');
            return;
        }

        console.log(`[Cleanup] Encontrados ${expiredRecords.length} videos expirados.`);

        // 2. Eliminar archivos físicos y actualizar BD
        for (const record of expiredRecords) {
            try {
                if (fs.existsSync(record.video_path)) {
                    await fs.promises.unlink(record.video_path);
                    console.log(`[Cleanup] Video eliminado: ${record.video_path}`);
                }
            } catch (fileError) {
                console.error(`[Cleanup] Error eliminando archivo ${record.video_path}:`, fileError);
            }

            // Actualizar registro
            await db('video_compositions')
                .where({ id: record.id })
                .update({
                    video_path: null,
                    expiration_time: null
                });
        }

        console.log('[Cleanup] Limpieza completada con éxito.');
    } catch (error) {
        console.error('[Cleanup] Error en proceso de limpieza:', error);
    }
}


// Intervalo de 15 minutos (en milisegundos)
const CLEANUP_INTERVAL = 15 * 60 * 1000;

// Iniciar programador cuando el servidor arranque
export function startVideoCleanupScheduler() {
    // Ejecutar inmediatamente al inicio
    cleanExpiredVideos();

    // Programar ejecución periódica
    setInterval(cleanExpiredVideos, CLEANUP_INTERVAL);
    console.log(`[Cleanup] Programador iniciado. Ejecutando cada ${CLEANUP_INTERVAL / 60000} minutos.`);
}

