require('dotenv').config();
const ftp = require("basic-ftp");
const fs = require("fs");

async function readFile() {
    const client = new ftp.Client();
    try {
        await client.access({
            host: process.env.FTP_HOST,
            user: process.env.FTP_USER,
            password: process.env.FTP_PASSWORD,
            secure: process.env.FTP_SECURE === "true"
        });
        
        await client.cd("/domains/dhriticlasses.com/public_html");
        await client.downloadTo("htaccess_copy.txt", ".htaccess");
        console.log("Downloaded .htaccess:");
        console.log(fs.readFileSync("htaccess_copy.txt", "utf8"));
        
        try {
            await client.cd("/domains/dhriticlasses.com/public_html/uploads");
            await client.downloadTo("uploads_htaccess_copy.txt", ".htaccess");
            console.log("\nDownloaded uploads/.htaccess:");
            console.log(fs.readFileSync("uploads_htaccess_copy.txt", "utf8"));
        } catch (e) {
            console.log("No .htaccess in uploads dir");
        }

    }
    catch (e) {
        console.error(e);
    }
    finally {
        client.close();
    }
}
readFile();
