import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { ObjectId } from 'mongodb';
import dbClient from '../utils/db';
import userUtils from '../utils/users';

class FilesController {
  static async postUpload(req, res) {
    try {
      // gets user id using token
      const { userId } = await userUtils.getIdAndKey(req);

      // if user not found returns Unauthorized
      if (!userId) {
        return res.status(401).send({ error: 'Unauthorized' });
      }

      // gets required data from request body
      const {
        name, type, parentId = 0, isPublic = false, data,
      } = req.body;

      // checking the fields if correct
      if (!name) {
        return res.status(400).send({ error: 'Missing name' });
      }
      if (!type || !['folder', 'file', 'image'].includes(type)) {
        return res.status(400).send({ error: 'Missing type' });
      }
      if (type !== 'folder' && !data) {
        return res.status(400).send({ error: 'Missing data' });
      }

      // checking is parentId is there
      if (parentId !== 0) {
        if (!ObjectId.isValid(parentId)) {
            return res.status(400).send({ error: 'Parent not found' });
        }
        const parentFile = await dbClient.db.collection('files').findOne({ _id: ObjectId(parentId) });
        if (!parentFile) {
          return res.status(400).send({ error: 'Parent not found' });
        }
        if (parentFile.type !== 'folder') {
          return res.status(400).send({ error: 'Parent is not a folder' });
        }
      }

      // prepare file document to insert into DB
      const fileDoc = {
        id: null,
        userId,
        name,
        type,
        isPublic,
        parentId,
      };

      // file data for type=file|image
      if (type === 'file' || type === 'image') {
        // decoding Base64 data
        const fileData = Buffer.from(data, 'base64');

        // define a storing folder path
        const folderPath = process.env.FOLDER_PATH || '/tmp/files_manager';

        // creates a folder if not exists
        if (!fs.existsSync(folderPath)) {
          fs.mkdirSync(folderPath, { recursive: true });
        }

        // makes a unique filename
        const fileName = `${uuidv4()}${path.extname(name)}`;

        // diefine local path for the file
        const localPath = path.join(folderPath, fileName);

        // writr the file to disk
        fs.writeFileSync(localPath, fileData);

        // add a localPath to file document
        fileDoc.localPath = localPath;
      }

      // inserts file document into DB
      const result = await dbClient.db.collection('files').insertOne(fileDoc);
      const { insertedId } = result;

      // removes _id field
      delete fileDoc._id;
      delete fileDoc.localPath;

      // adds generated ID to file document
      fileDoc.id = insertedId;

      // return the new file with status code 201
      return res.status(201).send(fileDoc);
    } catch (error) {
      console.error('Error uploading file:', error);
      return res.status(500).send({ error: 'Internal Server Error' });
    }
  }
}

export default FilesController;
