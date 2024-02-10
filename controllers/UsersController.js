import sha1 from 'sha1';
import dbClient from '../utils/db';

class UsersController {
  static async postNew(req, res) {
    const { email, password } = req.body;

    // check email & password
    if (!email) {
      return res.status(400).json({ error: 'Missing email' });
    }
    if (!password) {
      return res.status(400).json({ error: 'Missing password' });
    }

    // check if email already exists in db
    const existingUser = await dbClient.db.collection('users').findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'Already exist' });
    }

    // Hash password
    const hashedPassword = sha1(password);

    // new user
    const newUser = {
      email,
      password: hashedPassword,
    };

    // Insert new user into db
    try {
      const result = await dbClient.db.collection('users').insertOne(newUser);
      const { insertedId } = result;
      newUser.id = insertedId;

      // Return new user with email & id
      return res.status(201).json({ email: newUser.email, id: newUser.id });
    } catch (error) {
      console.error('Error inserting new user:', error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }
}

module.exports = UsersController;
