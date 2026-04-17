const ftp = require("basic-ftp");
const path = require("path");
const { Readable } = require('stream');

const FTP_CONFIG = {
    host: process.env.FTP_HOST,
    user: process.env.FTP_USER,
    password: process.env.FTP_PASSWORD,
    secure: process.env.FTP_SECURE === "true" // Default false if not set
};

/**
 * Uploads a file buffer to the FTP server
 * @param {Buffer} buffer - File content
 * @param {string} remotePath - Destination path on FTP server (e.g. 'public_html/uploads/resources/my-file.pdf')
 * @returns {Promise<void>}
 */
/**
 * Custom recursive directory creation to handle existing dirs gracefully
 */
async function mkDirRecursive(client, remoteDir) {
    const dirs = remoteDir.split("/").filter(p => p); // split by / and remove empty
    let currentPath = "";

    for (const dir of dirs) {
        currentPath += (currentPath ? "/" : "") + dir;
        try {
            await client.cd(currentPath);
        } catch (e) {
            // If cd fails, try to create it
            try {
                await client.created(currentPath); // .created() is NOT a method, use .mkdir() ???
                // basic-ftp doesn't expose mkdir easily if we are at root?
                // actually client.ensureDir is supposed to do this.
                // Let's use raw FTP command if needed, or client.access to reset?

                // Better approach:
                // We are at root (access called before).
                // "currentPath" is full path relative to root? 
                // No, we should rely on cd.

                // Wait, client.cd("/") first?
            } catch (mkdirErr) {
                // Ignore
            }
        }
    }
}

// SIMPLER FIX:
// Just try-catch the ensureDir but check error code better?
// Or: Split path and create one by one.

async function uploadFile(buffer, remotePath) {
    const client = new ftp.Client();
    // client.ftp.verbose = true; // Debugging on
    try {
        console.log(`[FTP] Connecting to: ${FTP_CONFIG.host} as ${FTP_CONFIG.user}`);

        if (!FTP_CONFIG.host || !FTP_CONFIG.user || !FTP_CONFIG.password) {
            const error = new Error("FTP credentials missing! Check FTP_HOST, FTP_USER, FTP_PASSWORD environment variables.");
            console.error("❌ [FTP] FATAL ERROR:", error.message);
            throw error;
        }

        await client.access(FTP_CONFIG);
        console.log("[FTP] Connected successfully");

        // Ensure we use forward slashes for FTP paths
        const remotePathPosix = remotePath.split(path.sep).join("/");
        const dir = path.posix.dirname(remotePathPosix);
        const fileName = path.posix.basename(remotePathPosix);

        console.log(`[FTP] Ensuring directory exists: ${dir}`);
        // ensureDir changes CWD to the directory!
        await client.ensureDir(dir);

        const currentDir = await client.pwd();
        console.log(`[FTP] Current directory: ${currentDir}`);

        console.log(`[FTP] Uploading file: ${fileName} (${buffer.length} bytes)`);
        const stream = Readable.from(buffer);
        // Upload with just filename since we are already in the dir
        await client.uploadFrom(stream, fileName);

        console.log("✅ [FTP] Upload success:", fileName);
    } catch (err) {
        console.error("❌ ==========================================");
        console.error("❌ [FTP] UPLOAD FAILED - HOSTINGER CONNECTION ERROR");
        console.error("❌ ==========================================");
        console.error("❌ [FTP] Error Name:", err.name);
        console.error("❌ [FTP] Error Message:", err.message);
        console.error("❌ [FTP] Remote Path:", remotePath);
        console.error("❌ [FTP] Host:", FTP_CONFIG.host);
        console.error("❌ [FTP] Full Error:", err);
        console.error("❌ ==========================================");
        throw err; // Re-throw - NO FALLBACK TO SUPABASE
    } finally {
        client.close();
    }
}

/**
 * Deletes a file from the FTP server
 * @param {string} remotePath
 */
async function deleteFile(remotePath) {
    const client = new ftp.Client();
    try {
        console.log(`[FTP] Connecting to delete file: ${remotePath}`);
        await client.access(FTP_CONFIG);
        await client.remove(remotePath);
        console.log(`✅ [FTP] Deleted file: ${remotePath}`);
    } catch (err) {
        console.error("❌ ==========================================");
        console.error("❌ [FTP] DELETE FAILED - HOSTINGER CONNECTION ERROR");
        console.error("❌ ==========================================");
        console.error("❌ [FTP] Error:", err.message);
        console.error("❌ [FTP] Remote Path:", remotePath);
        console.error("❌ ==========================================");
        throw err; // Re-throw - NO FALLBACK
    } finally {
        client.close();
    }
}

module.exports = { uploadFile, deleteFile };
