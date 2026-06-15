require('dotenv').config();
const ftp = require("basic-ftp");

async function listDir() {
    const client = new ftp.Client();
    try {
        await client.access({
            host: "82.197.82.109", // The DB IP
            user: process.env.FTP_USER,
            password: process.env.FTP_PASSWORD,
            secure: process.env.FTP_SECURE === "true"
        });
        console.log("Connected to 82.197.82.109");
        await client.cd("/domains/dhriticlasses.com/public_html/uploads/blogs");
        const list = await client.list();
        console.log("Files in 82.197.82.109:");
        for (const file of list) {
             console.log(file.name);
        }
    }
    catch (e) {
        console.error("Failed to connect or list:", e.message);
    }
    finally {
        client.close();
    }
}
listDir();
