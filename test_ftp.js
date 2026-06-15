require('dotenv').config();
const ftp = require("basic-ftp");

async function listDir() {
    const client = new ftp.Client();
    try {
        await client.access({
            host: process.env.FTP_HOST,
            user: process.env.FTP_USER,
            password: process.env.FTP_PASSWORD,
            secure: process.env.FTP_SECURE === "true"
        });
        console.log("Connected");
        
        const current = await client.pwd();
        console.log("Current dir:", current);
        
        await client.cd(process.env.FTP_BASE_PATH + "/blogs");
        const list = await client.list();
        console.log("Files in " + process.env.FTP_BASE_PATH + "/blogs:");
        for (const file of list) {
             console.log(file.name);
        }
    }
    catch (e) {
        console.error(e);
    }
    finally {
        client.close();
    }
}
listDir();
