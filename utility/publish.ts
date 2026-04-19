// TODO: add docs

import fs from 'fs';
import path from 'path';
import { cwd } from 'process';
import FormData from 'form-data';
import axios from 'axios';

interface PackageJson {
  name?: string;
  version?: string;
  'swan-files'?: string[];
}

function getAllFiles(filePath: string): string[] {
  const stats = fs.statSync(filePath);

  if (stats.isFile()) {
    return [filePath];
  }

  if (stats.isDirectory()) {
    const files: string[] = [];
    for (const item of fs.readdirSync(filePath)) {
      const fullPath = path.join(filePath, item);
      files.push(...getAllFiles(fullPath));
    }
    return files;
  }

  return [];
}

function iterateSwanFiles(): string[] {
  const packageJsonPath = path.resolve(process.cwd(), 'package.json');
  const packageJsonRaw = fs.readFileSync(packageJsonPath, 'utf-8');
  const packageJson: PackageJson = JSON.parse(packageJsonRaw);

  const swanFiles = packageJson['swan-files'] || [];
  if (swanFiles.length === 0) {
    throw new Error('No "swan-files" found in package.json');
  }

  const accumulation_files: string[] = [];
  for (const fileOrDir of swanFiles) {
    const fullPath = path.resolve(process.cwd(), fileOrDir);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Path does not exist: ${fullPath}`);
    }

    const files = getAllFiles(fullPath);
    accumulation_files.push(...files);
  }
  return accumulation_files;
}

export async function publishWithCredential(base_url: string, auth_credential_path: string) {
  if (!auth_credential_path) {
    throw new Error(`Auth credential path cannot be empty`);
  }

  const abs_auth_credential_path = path.resolve(cwd(), auth_credential_path)
  if (!fs.existsSync(abs_auth_credential_path)) {
    throw new Error(`Auth credential path "${abs_auth_credential_path}" doesn't exist`);
  }

  const auth_credential = await fs.promises.readFile(abs_auth_credential_path, 'utf-8');
  const files = iterateSwanFiles();
  const package_json = files.find(f => f.endsWith('/package.json'));
  if (!package_json) {
    throw new Error(`"swan-files" must include file package.json`);
  }
  
  const base_project_dir = package_json.replace('/package.json', '');
  const package_json_data: PackageJson = JSON.parse(await fs.promises.readFile(package_json as string, 'utf-8'));

  // 1. check if version ok for publishing, this api should return publishing token
  const version = package_json_data.version;
  const name = package_json_data.name;
  if (!version) {
    throw new Error(`Your package.json has invalid version`);
  }
  if (!name) {
    throw new Error(`Your package.json has invalid name`);
  }
  let publising_token: string = '';
  try {
    const data = await axios.post<string>('/publish', { name, version }, {
      headers: { Authorization: auth_credential.trim() },
      baseURL: base_url
    });
    publising_token = data.data;
  } catch (err: any) {
    throw new Error(err?.response?.data);
  }

  // 2. check if files more than 1MB
  for (const file of files) {
    const stats = await fs.promises.stat(file);
    
    // Check if file size > 1MB
    if (stats.size > 1_048_576) {
      throw new Error(`File "${file}" has size more than 1MB: ${Math.round(stats.size / 1024)} KB\nKeep your agent code less than 1MB to use our deployment service.`);
    }
  }

  // 3. use publishing token to upload files
  const form = new FormData();

  // Append files to the form
  files.forEach((abs_file_path: string) => {
    const relative_path = path.relative(base_project_dir, abs_file_path);
    form.append('files', fs.createReadStream(abs_file_path));
    form.append('paths', relative_path);
  });

  try {
    console.log(`Upload ${files.length} file(s)...`);
    await axios.post('/send-files', form, {
      headers: {
        ...form.getHeaders(),
        Authorization: publising_token
      },
      baseURL: base_url,
      maxContentLength: Infinity,
      maxBodyLength: Infinity, // Needed for large files
    });
    console.log(`Published.`);
  } catch (err: any) {
    throw new Error(err?.response?.data);
  }
}
