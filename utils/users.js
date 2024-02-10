import dbClient from './db';
import redisClient from './redis';


const userUtils = {
  async getIdAndKey(request) {
    const objct = { userId: null, key: null };

    const token = request.header('X-Token');

    if (!token) return objct;

    objct.key = `auth_${token}`;

    objct.userId = await redisClient.get(objct.key);

    return objct;
  },

  async getUser(query) {
    const user = await dbClient.db.collection('users').findOne(query);
    return user;
  },
};

export default userUtils;
