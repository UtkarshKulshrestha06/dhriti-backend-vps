require('dotenv').config();
const ftp = require("basic-ftp");

async function checkPerms() {
    const client = new ftp.Client();
    try {
        await client.access({
            host: process.env.FTP_HOST,
            user: process.env.FTP_USER,
            password: process.env.FTP_PASSWORD,
            secure: process.env.FTP_SECURE === "true"
        });
        
        await client.cd("/domains/dhriticlasses.com/public_html");
        const list = await client.list();
        for (const file of list) {
             if (file.name === 'index.html') {
                 console.log("index.html details:", file.modifiedAt, file.size);
             }
        }
    }
    catch (e) {
        console.error(e);
    }
    finally {
        client.close();
    }
}
checkPerms();
