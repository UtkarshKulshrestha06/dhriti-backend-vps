require('dotenv').config();
const ftp = require("basic-ftp");

async function listDir() {
    const client = new ftp.Client();
    try {
        await client.access({
            host: "88.222.243.152", // The actual website IP
            user: process.env.FTP_USER,
            password: process.env.FTP_PASSWORD,
            secure: process.env.FTP_SECURE === "true"
        });
        console.log("Connected to 88.222.243.152");
        await client.cd("/domains/dhriticlasses.com/public_html/uploads/blogs");
        const list = await client.list();
        console.log("Files in 88.222.243.152:");
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
