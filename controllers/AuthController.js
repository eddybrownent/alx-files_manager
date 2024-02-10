import { v4 as uuidv4 } from 'uuid';
import sha1 from 'sha1';
import redisClient from '../utils/redis';
import userUtils from '../utils/users';

class AuthController {
  static async getConnected(req, res) {
    const authHeader = req.header('Authorization') || '';

    const base64Credentials = authHeader.split(' ')[1];

    if (!base64Credentials) { return res.status(401).json({ error: 'Unauthorized' }); }

    const decodedCredentials = Buffer.from(base64Credentials, 'base64').toString(
      'utf-8',
    );

    const [email, password] = decodedCredentials.split(':');

    if (!email || !password) { return res.status(401).json({ error: 'Unauthorized' }); }

    const hashedPassword = sha1(password);

    const user = await userUtils.getUser({
      email,
      password: hashedPassword,
    });

    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const token = uuidv4();
    const key = `auth_${token}`;

    await redisClient.set(key, user._id.toString(), 24 * 3600);

    return res.status(200).json({ token });
  }

  static async getDisconnected(req, res) {
    const { userId, key } = await userUtils.getUserIdAndKey(req);

    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    await redisClient.del(key);

    return res.status(204).json();
  }
}

export default AuthController;
