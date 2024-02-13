import Queue from 'bull';
import imageThumbnail from 'image-thumbnail';
import fs from 'fs';
import { ObjectId } from 'mongodb';
import dbClient from './utils/db';

const fileQueue = new Queue('fileQueue', 'redis://127.0.0.1:6379');

fileQueue.process(async (job) => {
  const { fileId, userId } = job.data;
  if (!fileId || !userId) {
    throw new Error('Missing fileId or userId');
  }

  const file = await dbClient.db.collection('files').findOne({ _id: ObjectId(fileId), userId });
  if (!file) {
    throw new Error('File not found');
  }

  const path = file.localPath;
  const thumbnail500 = await imageThumbnail(path, { width: 500 });
  const thumbnail250 = await imageThumbnail(path, { width: 250 });
  const thumbnail100 = await imageThumbnail(path, { width: 100 });

  const filenameWithoutExtension = path.substring(0, path.lastIndexOf('.'));
  await Promise.all([
    fs.promises.writeFile(`${filenameWithoutExtension}_500.jpg`, thumbnail500),
    fs.promises.writeFile(`${filenameWithoutExtension}_250.jpg`, thumbnail250),
    fs.promises.writeFile(`${filenameWithoutExtension}_100.jpg`, thumbnail100),
  ]);
});
