const { google } = require("googleapis");
const fs = require("fs");
const readline = require("readline");
const path = require("path");
const tar = require("tar");
const { exec } = require("child_process");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function askQuestion(query) {
  return new Promise((resolve) => rl.question(query, resolve));
}

function execCommand(command) {
  return new Promise((resolve, reject) => {
    const process = exec(command, (error, stdout, stderr) => {
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

async function downloadFile(drive, fileId, filePath) {
  const dest = fs.createWriteStream(filePath);
  try {
    console.log(`Mengunduh file ${filePath}...`);
    await new Promise((resolve, reject) => {
      drive.files
        .get({ fileId, alt: "media" }, { responseType: "stream" })
        .then((res) => {
          res.data
            .on("end", () => resolve())
            .on("error", (err) => reject(err))
            .pipe(dest);
        });
    });
    console.log(`File ${filePath} berhasil diunduh!`);
  } catch (error) {
    console.error(`Gagal mengunduh file ${filePath}: ${error.message}`);
    throw error;
  }
}

async function extractBackup(archivePath, destination) {
  console.log(`Mengekstrak file ${archivePath} ke ${destination}...`);
  await tar.extract({
    file: archivePath,
    cwd: destination,
  });
  console.log(`Ekstraksi selesai!`);
}

async function restoreBackup() {
  console.log("Memulai proses restore backup...");

  try {
    const configPath = path.join(__dirname, "config.json");
    if (!fs.existsSync(configPath)) {
      throw new Error("Config.json tidak ditemukan. Pastikan file konfigurasi tersedia.");
    }

    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    if (!config.tokens) {
      throw new Error("Token autentikasi tidak ditemukan. Jalankan 'auth.sh' terlebih dahulu.");
    }

    const oAuth2Client = new google.auth.OAuth2();
    oAuth2Client.setCredentials(config.tokens);
    const drive = google.drive({ version: "v3", auth: oAuth2Client });

    console.log("Mengambil daftar folder backup dari Google Drive...");
    const { data: { files: backupFolders } } = await drive.files.list({
      q: "mimeType='application/vnd.google-apps.folder' and name='CHI-BACKUP' and 'root' in parents",
      fields: "files(id, name)",
    });

    if (backupFolders.length === 0) {
      throw new Error("Folder 'CHI-BACKUP' tidak ditemukan di Google Drive.");
    }

    const chiBackupFolderId = backupFolders[0].id;
    const { data: { files: dateFolders } } = await drive.files.list({
      q: `'${chiBackupFolderId}' in parents and mimeType='application/vnd.google-apps.folder'`,
      fields: "files(id, name)",
    });

    if (dateFolders.length === 0) {
      throw new Error("Tidak ada folder tanggal di dalam 'CHI-BACKUP'.");
    }

    console.log("Daftar folder tanggal:");
    dateFolders.forEach((folder, index) => console.log(`${index + 1}. ${folder.name}`));

    const folderIndex = await askQuestion("Pilih nomor folder backup: ");
    const selectedFolder = dateFolders[parseInt(folderIndex) - 1];
    if (!selectedFolder) {
      throw new Error("Pilihan folder tidak valid.");
    }

    console.log(`Mengambil daftar file dalam folder ${selectedFolder.name}...`);
    const { data: { files: backupFiles } } = await drive.files.list({
      q: `'${selectedFolder.id}' in parents`,
      fields: "files(id, name)",
    });

    const nodeFile = backupFiles.find((file) => file.name.includes("node.tar.gz"));
    const backupFile = backupFiles.find((file) => file.name.includes("backup.tar.gz"));

    if (!nodeFile || !backupFile) {
      throw new Error("File backup tidak lengkap di folder ini.");
    }

    const restoreDir = "/root/miawrestore";
    if (!fs.existsSync(restoreDir)) {
      fs.mkdirSync(restoreDir, { recursive: true });
    }

    const nodeFilePath = path.join(restoreDir, "node.tar.gz");
    const backupFilePath = path.join(restoreDir, "backup.tar.gz");

    await downloadFile(drive, nodeFile.id, nodeFilePath);
    await downloadFile(drive, backupFile.id, backupFilePath);

    console.log("Mengekstrak file backup...");
    await extractBackup(nodeFilePath, restoreDir);
    await extractBackup(backupFilePath, restoreDir);

    console.log("Proses restore backup selesai!");
  } catch (error) {
    console.error("Terjadi kesalahan saat restore backup:", error.message);
  } finally {
    rl.close();
  }
}
restoreBackup();