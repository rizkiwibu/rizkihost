const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");
const readline = require("readline");
const tar = require("tar");
const configPath = path.join(__dirname, "config.json");
let config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function askQuestion(query) {
  return new Promise((resolve) => rl.question(query, resolve));
}

function execCommand(command) {
  return new Promise((resolve, reject) => {
    const process = exec(command, { maxBuffer: 999999999 * 1024 * 10 }, (error, stdout, stderr) => { // 10 MB buffer
      if (error) {
        reject({ error, stderr });
      } else {
        resolve(stdout);
      }
    });
    process.stdout.on("data", (data) => console.log(data.toString()));
    process.stderr.on("data", (data) => console.error(data.toString()));
  });
}

async function createTar(archivePath, files) {
  console.log(`Membuat arsip ${archivePath}...`);
  return tar.create(
    {
      gzip: true,
      file: archivePath,
      noDirRecurse: false,
    },
    files
  );
}

async function createBackup() {
  console.log("Membuat backup...");

  const tempSqlFile = "/alldb.sql";
  const backupFile = path.join(__dirname, "backup.tar.gz");
  const nodeBackupFile = path.join(__dirname, "node.tar.gz");
  async function pukulChiwa(archivePath, files) {
    console.log(`Membuat arsip ${archivePath}...`);
    return tar.create(
      {
        gzip: true,
        file: archivePath,
        noDirRecurse: false,
        filter: (path) => {
          return !(
            path.includes("node_modules") || 
            path.includes(".cache") || 
            path.includes(".npm") || 
            path.endsWith(".log")
          );
        },
      },
      files
    );
  }
  try {
    if(config.backup_choice === '0') {
    console.log("Membuat dump database...");
    await execCommand(`sudo mysqldump -u root --all-databases > ${tempSqlFile}`);

    console.log("Menghentikan Wings...");
    await execCommand(`sudo systemctl stop wings`);

    console.log("Membuat backup node...");

await pukulChiwa(nodeBackupFile, ["/var/lib/pterodactyl", "/etc/pterodactyl"]);


    console.log("Membuat backup utama...");
    await createTar(backupFile, [
      "/etc/letsencrypt",
      "/var/www/",
      "/etc/nginx/sites-available/",
      tempSqlFile,
    ]);

    console.log("Memulai kembali Wings...");
    await execCommand(`sudo systemctl start wings`);

    console.log("Backup selesai!");
    return { backupFile, nodeBackupFile };
  }
  if(config.backup_choice === '1') {
    console.log("Membuat dump database...");
    await execCommand(`sudo mysqldump -u root --all-databases > ${tempSqlFile}`);

    console.log("Membuat backup utama...");
    await createTar(backupFile, [
      "/etc/letsencrypt",
      "/var/www/",
      "/etc/nginx/sites-available/",
      tempSqlFile,
    ]);

    console.log("Backup selesai!");
    return { backupFile };
  }
  if(config.backup_choice === '2') {
await pukulChiwa(nodeBackupFile, ["/var/lib/pterodactyl", "/etc/pterodactyl"]);
    console.log("Backup selesai!");
    return { nodeBackupFile };
  }
  } catch (error) {
    console.error("Terjadi kesalahan saat membuat backup:", error.error || error);
    throw error;
  } finally {
    console.log("Membersihkan file sementara...");
    await execCommand(`rm -f ${tempSqlFile}`);
  }
}

async function uploadFile(drive, filePath, folderId) {
  const fileName = path.basename(filePath);
  const fileMetadata = {
    name: fileName,
    parents: [folderId],
  };
  const media = {
    mimeType: "application/gzip",
    body: fs.createReadStream(filePath),
  };

  try {
    console.log(`Mengupload file ${fileName} ke Google Drive...`);
    const file = await drive.files.create({
      requestBody: fileMetadata,
      media: media,
      supportsAllDrives: true,
      fields: "id",
    });

    console.log(`File ${fileName} berhasil diupload! File ID: ${file.data.id}`);
    return file.data.id;
  } catch (error) {
    console.error(`Gagal mengupload file ${fileName}: ${error.message}`);
    throw error;
  }
}
async function getDriveChoice(drive) {
  const choice = await askQuestion("Gunakan penyimpanan (1) Pribadi atau (2) Bersama? (1/2): ");
  
  if (choice === "2") {
    console.log("Mengambil daftar Drive bersama...");
    const res = await drive.drives.list({ fields: "drives(id, name)" });
    if (res.data.drives.length === 0) {
      console.log("Tidak ada Drive bersama yang ditemukan. Menggunakan penyimpanan pribadi.");
      return "root";
    }

    console.log("Drive bersama tersedia:");
    res.data.drives.forEach((d, index) => console.log(`${index + 1}. ${d.name} (${d.id})`));
    const selectedIndex = await askQuestion("Pilih nomor Drive bersama: ");
    const selectedDrive = res.data.drives[selectedIndex - 1];

    console.log(`Drive bersama dipilih: ${selectedDrive.name}`);
    return selectedDrive.id;
  } 

  console.log("Menggunakan penyimpanan pribadi (root).");
  return "root";
}

async function main() {
  try {
    console.log("Memuat konfigurasi...");
    const configPath = path.join(__dirname, "config.json");
    if (!fs.existsSync(configPath)) {
      throw new Error("Config.json tidak ditemukan. Silakan buat file konfigurasi terlebih dahulu.");
    }


    if (!config.tokens) {
      throw new Error("Token autentikasi tidak ditemukan.");
    }

    const oAuth2Client = new google.auth.OAuth2();
    oAuth2Client.setCredentials(config.tokens);
    const drive = google.drive({ version: "v3", auth: oAuth2Client });
    if (!config.backup_choice) {
      const askOpts = await askQuestion(
        'Pilih 0 untuk menyandangkan semuanya, 1 untuk menyandangkan data panel saja, atau 2 untuk menyandangkan data node saja: '
      );
    
      // Validasi input
      if (askOpts !== '0' && askOpts !== '1' && askOpts !== '2') {
        return console.log("Input tidak valid. Silakan masukkan 0, 1, atau 2.");
      }
    
      // Simpan pilihan
      config.backup_choice = askOpts;
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    }
    
    // Menentukan pilihan penyimpanan
    let selectedDriveId = config.driveId;
    if(!config.driveId) {
      let dasarjaswaaaa = await getDriveChoice(drive);
      config.driveId = dasarjaswaaaa;
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      execCommand('pm2 restart backup')

      return console.log('Konfigurasi berhasil,silahkan gunakan perintah pm2 logs backup untuk melihat progress')
    }

    

    console.log("Mencari folder utama 'CHIWA-BACKUP'...");
    const response = await drive.files.list({
      q: `name = 'CHIWA-BACKUP' and mimeType = 'application/vnd.google-apps.folder' and '${selectedDriveId}' in parents`,
      spaces: "drive",
      fields: "files(id, name)",
      supportsAllDrives: true,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    let mainFolderId;
    if (response.data.files.length > 0) {
      mainFolderId = response.data.files[0].id;
      console.log("Folder ditemukan.");
    } else {
      console.log("Folder tidak ditemukan, membuat folder baru...");
      const mainFolder = await drive.files.create({
        requestBody: {
          name: "CHIWA-BACKUP",
          supportsAllDrives: true,
          mimeType: "application/vnd.google-apps.folder",
          parents: [selectedDriveId],
        },
        fields: "id",
        supportsAllDrives: true,
      });
      mainFolderId = mainFolder.data.id;
    }

    // Membuat folder berdasarkan tanggal
    const folderName = new Date().toISOString().split("T")[0];
    const dateFolder = await drive.files.create({
      requestBody: {
        name: folderName,
        mimeType: "application/vnd.google-apps.folder",
        parents: [mainFolderId],
        supportsAllDrives: true
      },
      fields: "id",
      supportsAllDrives: true,
    });

    const dateFolderId = dateFolder.data.id;

    console.log(`Folder tanggal berhasil dibuat: ${folderName}`);
let chiwaaaaa= await createBackup()
if (config.backup_choice === '0'){
let backupFile = await uploadFile(drive, chiwaaaaa.backupFile, dateFolderId)
let nodeFile = await uploadFile(drive, chiwaaaaa.nodeBackupFile, dateFolderId)
await setFilePublic(drive, backupFile)
await setFilePublic(drive, nodeFile)
}
if (config.backup_choice === '1'){
let backupFile = await uploadFile(drive, chiwaaaaa.backupFile, dateFolderId)
await setFilePublic(drive, backupFile)
}
if (config.backup_choice === '2'){
let nodeFile = await uploadFile(drive, chiwaaaaa.nodeBackupFile, dateFolderId)
await setFilePublic(drive, nodeFile)
}
    rl.close();
  } catch (error) {
    console.error(`Terjadi kesalahan: ${error.message}`);
    rl.close();
  }
}

async function setFilePublic(drive, fileId) {
  await drive.permissions.create({
    fileId: fileId,
    requestBody: {
      role: 'reader',
      type: 'anyone',
      supportsAllDrives: true,
    },
  });

  const fileLink = `https://drive.google.com/file/d/${fileId}/view?usp=sharing`;
  console.log(`File: ${fileId} Privellage has been changed`);
  console.log(`Link file: ${fileLink}`);
}



main();