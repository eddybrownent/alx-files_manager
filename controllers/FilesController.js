import mimeTypes from 'mime-types';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { ObjectId } from 'mongodb';
import dbClient from '../utils/db';
import userUtils from '../utils/users';
import redisClient from '../utils/redis';
import fileQueue from '../worker';

class FilesController {
  static async postUpload(req, res) {
    try {
      const { userId } = await userUtils.getIdAndKey(req);

      if (!userId) {
        return res.status(401).send({ error: 'Unauthorized' });
      }

      const {
        name, type, parentId = 0, isPublic = false, data,
      } = req.body;

      if (!name) {
        return res.status(400).send({ error: 'Missing name' });
      }
      if (!type || !['folder', 'file', 'image'].includes(type)) {
        return res.status(400).send({ error: 'Missing type' });
      }
      if (type !== 'folder' && !data) {
        return res.status(400).send({ error: 'Missing data' });
      }

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

      const fileDoc = {
        userId,
        name,
        type,
        isPublic,
        parentId,
      };

      if (type === 'file' || type === 'image') {
        const fileData = Buffer.from(data, 'base64');
        const folderPath = process.env.FOLDER_PATH || '/tmp/files_manager';
        if (!fs.existsSync(folderPath)) {
          fs.mkdirSync(folderPath, { recursive: true });
        }
        const fileName = `${uuidv4()}${path.extname(name)}`;
        const localPath = path.join(folderPath, fileName);
        fs.writeFileSync(localPath, fileData);
        fileDoc.localPath = localPath;

        // Add a job to the fileQueue for thumbnail generation
        fileQueue.add({ userId: userId.toString(), fileId: fileDoc._id.toString() });
      }

      const result = await dbClient.db.collection('files').insertOne(fileDoc);
      const { insertedId } = result;

      delete fileDoc._id;
      delete fileDoc.localPath;
      fileDoc.id = insertedId;

      const responseObj = {
        id: fileDoc.id,
        ...fileDoc,
      };

      return res.status(201).send(responseObj);
    } catch (error) {
      console.error('Error uploading file:', error);
      return res.status(500).send({ error: 'Internal Server Error' });
    }
  }

  static async getShow(req, res) {
    try {
      // check for the X-Token header
      const token = req.header('X-Token');
      if (!token) {
        return res.status(401).send({ error: 'Unauthorized' });
      }

      // check if the token exists the redis
      const redisToken = await redisClient.get(`auth_${token}`);
      if (!redisToken) {
        return res.status(401).send({ error: 'Unauthorized' });
      }

      // Retrieve user ID based on the token
      const { userId } = await userUtils.getIdAndKey(req);

      // If user not found, return Unauthorized
      if (!userId) {
        return res.status(401).send({ error: 'Unauthorized' });
      }

      const fileId = req.params.id;
      // Retrieve file document based on the ID
      const file = await dbClient.db.collection('files').findOne({ _id: ObjectId(fileId), userId });

      // If no file document found, return Not Found
      if (!file) {
        return res.status(404).send({ error: 'Not found' });
      }

      // Remove unwanted fields
      const sanitizedFile = {
        id: fileId,
        ...file,
        localPath: undefined,
        _id: undefined,
      };

      // Return the file document
      return res.status(200).send(sanitizedFile);
    } catch (error) {
      return res.status(404).send({ error: 'Not found' });
    }
  }

  static async getIndex(req, res) {
    try {
      // check for the X-Token header
      const token = req.header('X-Token');
      if (!token) {
        return res.status(401).send({ error: 'Unauthorized' });
      }

      // check if the token exists the redis
      const redisToken = await redisClient.get(`auth_${token}`);
      if (!redisToken) {
        return res.status(401).send({ error: 'Unauthorized' });
      }

      // get user ID based on the token
      const { userId } = await userUtils.getIdAndKey(req);

      // If user not found, return Unauthorized
      if (!userId) {
        return res.status(401).send({ error: 'Unauthorized' });
      }

      // get parentId from query parameters or set default to 0
      let parentId = req.query.parentId || '0';
      if (parentId === '0') parentId = 0;

      // pagination parameters
      let page = Number(req.query.page) || 0;
      if (Number.isNaN(page)) page = 0;

      // Construct aggregation pipeline based on parentId and pagination
      const aggregationMatch = { $and: [{ parentId }] };
      let aggregateData = [{ $match: aggregationMatch }, { $skip: page * 20 }, { $limit: 20 }];
      if (parentId === 0) aggregateData = [{ $skip: page * 20 }, { $limit: 20 }];

      // aggregation pipeline to retrieve files
      const filesCursor = await dbClient.db.collection('files').aggregate(aggregateData);

      // Convert cursor to array of files
      const files = await filesCursor.toArray();

      // Sanitize files and remove unnecessary fields
      const sanitizedFiles = files.map((file) => ({
        id: file._id.toString(),
        userId: file.userId,
        name: file.name,
        type: file.type,
        isPublic: file.isPublic,
        parentId: file.parentId,
        localPath: undefined, // Remove localPath for security
        _id: undefined, // Remove MongoDB-specific _id field
      }));

      // Return the list of files
      return res.status(200).send(sanitizedFiles);
    } catch (error) {
      return res.status(404).send({ error: 'Not found' });
    }
  }

  static async putPublish(req, res) {
    try {
      // check for the X-Token header
      const token = req.header('X-Token');
      if (!token) {
        return res.status(401).send({ error: 'Unauthorized' });
      }

      // check if the token exists the redis
      const redisToken = await redisClient.get(`auth_${token}`);
      if (!redisToken) {
        return res.status(401).send({ error: 'Unauthorized' });
      }

      // get user ID using token
      const { userId } = await userUtils.getIdAndKey(req);

      // If user not found, return Unauthorized
      if (!userId) {
        return res.status(401).send({ error: 'Unauthorized' });
      }

      const fileId = req.params.id;
      // get file using the ID
      const file = await dbClient.db.collection('files').findOne({ _id: ObjectId(fileId), userId });

      if (!file) {
        return res.status(404).send({ error: 'Not found' });
      }

      // change the value of isPublic to true
      await dbClient.db.collection('files').updateOne({ _id: ObjectId(fileId) }, { $set: { isPublic: true } });

      // Sanitize the response
      const sanitizedFile = {
        id: fileId,
        userId: file.userId,
        name: file.name,
        type: file.type,
        isPublic: true,
        parentId: file.parentId,
      };

      // return the doc
      return res.status(200).send(sanitizedFile);
    } catch (error) {
      return res.status(404).send({ error: 'Not found' });
    }
  }

  static async putUnpublish(req, res) {
    try {
      // check for the X-Token header
      const token = req.header('X-Token');
      if (!token) {
        return res.status(401).send({ error: 'Unauthorized' });
      }

      // check if the token exists the redis
      const redisToken = await redisClient.get(`auth_${token}`);
      if (!redisToken) {
        return res.status(401).send({ error: 'Unauthorized' });
      }

      // gets the user using id
      const { userId } = await userUtils.getIdAndKey(req);

      if (!userId) {
        return res.status(401).send({ error: 'Unauthorized' });
      }

      const fileId = req.params.id;
      // gets file using the ID
      const file = await dbClient.db.collection('files').findOne({ _id: ObjectId(fileId), userId });

      if (!file) {
        return res.status(404).send({ error: 'Not found' });
      }

      // change value of isPublic to false
      await dbClient.db.collection('files').updateOne({ _id: ObjectId(fileId) }, { $set: { isPublic: false } });

      // Sanitize the response
      const sanitizedFile = {
        id: fileId,
        userId: file.userId,
        name: file.name,
        type: file.type,
        isPublic: false,
        parentId: file.parentId,
      };

      // Return the doc
      return res.status(200).send(sanitizedFile);
    } catch (error) {
      return res.status(404).send({ error: 'Not found' });
    }
  }

  static async getFile(req, res) {
    const fileId = req.params.id;
    const { size } = req.query; // Retrieve size parameter from query

    // get file using ID
    const file = await dbClient.db.collection('files').findOne({ _id: ObjectId(fileId) });

    if (!file) {
      return res.status(404).send({ error: 'Not found' });
    }

    // check if file is public or the user is authenticated and owner of the file
    const { userId } = await userUtils.getIdAndKey(req);
    if (!file.isPublic && (!userId || file.userId !== userId)) {
      return res.status(404).send({ error: 'Not found' });
    }

    if (file.type === 'folder') {
      return res.status(400).send({ error: "A folder doesn't have content" });
    }

    let filePath = file.localPath;
    if (!Number.isNaN(Number(size)) && [500, 250, 100].includes(Number(size))) {
      filePath += `_${size}`;
    }

    // Check if the file is locally present
    if (!fs.existsSync(filePath)) {
      return res.status(404).send({ error: 'Not found' });
    }

    // Get the MIME-type based on the name of the file
    const mimeType = mimeTypes.lookup(file.name);

    // Return the content of the file with the correct MIME-type
    res.setHeader('Content-Type', mimeType);
    const fileStream = fs.createReadStream(filePath); // Use modified filePath
    fileStream.pipe(res);

    return res.status(404).send({ error: 'Not found' });
  }
}

export default FilesController;
