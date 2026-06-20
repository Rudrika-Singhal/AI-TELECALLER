// require('dotenv').config();
// const express = require('express');
// const { Pool } = require('pg');

// const app = express();
// app.use(express.json());

// // Database connection
// // const pool = new Pool({
// //   host: 'localhost',
// //   port: 5432,
// //   database: 'telecaller_db',
// //   user: 'postgres',
// //   password: 'rudrika05@R'
// // });
// const pool = new Pool({
//   host: process.env.DB_HOST,
//   port: process.env.DB_PORT,
//   database: process.env.DB_NAME,
//   user: process.env.DB_USER,
//   password: process.env.DB_PASSWORD
// });

// // Check database connected hai
// pool.connect((err) => {
//   if (err) {
//     console.log('Database connection failed:', err);
//   } else {
//     console.log('Database connected successfully!');
//   }
// });

// // Test route
// app.get('/', (req, res) => {
//   res.send('AI Telecaller system chal raha hai!');
// });

// // Lead add karne ka route
// app.post('/leads', async (req, res) => {
//   const { name, phone } = req.body;
//   const result = await pool.query(
//     'INSERT INTO leads (name, phone) VALUES ($1, $2) RETURNING *',
//     [name, phone]
//   );
//   res.json(result.rows[0]);
// });

// // Leads dekhne ka route
// app.get('/leads', async (req, res) => {
//   const result = await pool.query('SELECT * FROM leads');
//   res.json(result.rows);
// });

// app.listen(3000, () => {
//   console.log('Server start ho gaya — port 3000 par');
// });












require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const axios = require('axios');
const path = require('path');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD
});

pool.connect((err) => {
  if (err) {
    console.log('Database connection failed:', err);
  } else {
    console.log('Database connected successfully!');
  }
});

const Groq = require('groq-sdk');
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const conversations = {};

// Email setup
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

async function sendEmail(to, subject, text) {
  try {
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to,
      subject,
      text
    });
    console.log('Email sent successfully!');
  } catch (err) {
    console.log('Email error:', err.message);
  }
}

// Auth
const ADMIN_USER = {
  username: 'admin',
  password: bcrypt.hashSync('admin123', 10)
};

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (username !== ADMIN_USER.username) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const isValid = bcrypt.compareSync(password, ADMIN_USER.password);
  if (!isValid) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = jwt.sign({ username }, process.env.JWT_SECRET, { expiresIn: '24h' });
  res.json({ token });
});

const verifyToken = (req, res, next) => {
  const token = req.headers['authorization'];
  if (!token) return res.status(401).json({ error: 'Token required' });
  try {
    jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Leads
app.post('/leads', async (req, res) => {
  const { name, phone } = req.body;
  const result = await pool.query(
    'INSERT INTO leads (name, phone) VALUES ($1, $2) RETURNING *',
    [name, phone]
  );
  res.json(result.rows[0]);
});

app.get('/leads', async (req, res) => {
  const result = await pool.query('SELECT * FROM leads');
  res.json(result.rows);
});

app.put('/leads/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const result = await pool.query(
    'UPDATE leads SET status = $1 WHERE id = $2 RETURNING *',
    [status, id]
  );
  res.json(result.rows[0]);
});

// Call Logs
app.get('/call-logs', async (req, res) => {
  const result = await pool.query('SELECT * FROM call_logs ORDER BY created_at DESC');
  res.json(result.rows);
});

// AI Test
app.post('/ai-test', async (req, res) => {
  const { message } = req.body;
  const response = await groq.chat.completions.create({
    messages: [
      {
        role: 'system',
        content: `Tum ek helpful AI assistant ho.
- Agar tumhe kisi cheez ki pakki jaankari nahi hai toh clearly bolo "Mujhe is baare mein pakki jaankari nahi hai"
- Kabhi bhi guess ya galat information mat do
- Education courses ke baare mein help karo
- Hindi, English, ya koi bhi language mein reply karo
- Friendly raho`
      },
      { role: 'user', content: message }
    ],
    model: 'llama-3.3-70b-versatile',
  });
  res.json({ reply: response.choices[0].message.content });
});

// Chat with Sentiment Analysis + Lead Scoring + Email
app.post('/chat', async (req, res) => {
  const { lead_id, message } = req.body;

  if (!conversations[lead_id]) {
    const leadResult = await pool.query('SELECT * FROM leads WHERE id = $1', [lead_id]);
    const lead = leadResult.rows[0];
    const leadName = lead ? lead.name : 'Customer';
    const leadPhone = lead ? lead.phone : '';

    conversations[lead_id] = [
      {
        role: 'system',
        content: `Tum ek helpful AI telecaller ho.
- Customer ka naam "${leadName}" hai aur phone "${leadPhone}" hai
- Inhe naam se bulao — "${leadName} ji"
- Tum EdTech company ke liye kaam karte ho
- Agar tumhe kisi cheez ki pakki jaankari nahi hai toh clearly bolo "Mujhe is baare mein pakki jaankari nahi hai"
- Kabhi bhi guess ya galat information mat do
- Customer jo bhi pooche honestly jawab do
- Hindi, English, ya koi bhi language mein reply karo jisme customer baat kare
- Friendly aur helpful raho`
      }
    ];
  }

  conversations[lead_id].push({ role: 'user', content: message });

  const response = await groq.chat.completions.create({
    messages: conversations[lead_id],
    model: 'llama-3.3-70b-versatile',
  });

  const reply = response.choices[0].message.content;
  conversations[lead_id].push({ role: 'assistant', content: reply });

  // Sentiment Analysis
  const sentimentResponse = await groq.chat.completions.create({
    messages: [
      {
        role: 'system',
        content: `Analyze the sentiment of this customer message and reply with ONLY one word: POSITIVE, NEGATIVE, or NEUTRAL. Nothing else.`
      },
      { role: 'user', content: message }
    ],
    model: 'llama-3.3-70b-versatile',
  });

  const sentiment = sentimentResponse.choices[0].message.content.trim().toUpperCase();

  // Lead Scoring
  const scoreResponse = await groq.chat.completions.create({
    messages: [
      {
        role: 'system',
        content: `Based on this customer message, give a lead score from 1 to 10.
10 = Very interested, ready to buy
5 = Neutral, needs more convincing
1 = Not interested at all
Reply with ONLY a number between 1-10. Nothing else.`
      },
      { role: 'user', content: message }
    ],
    model: 'llama-3.3-70b-versatile',
  });

  const score = parseInt(scoreResponse.choices[0].message.content.trim()) || 5;
  await pool.query('UPDATE leads SET score = $1 WHERE id = $2', [score, lead_id]);

  // Auto status update + Email
  if (sentiment === 'POSITIVE') {
    await pool.query('UPDATE leads SET status = $1 WHERE id = $2', ['interested', lead_id]);

    // Email notification
    const leadData = await pool.query('SELECT * FROM leads WHERE id = $1', [lead_id]);
    const lead = leadData.rows[0];
    await sendEmail(
      process.env.ADMIN_EMAIL,
      `🎉 New Interested Lead — ${lead.name}`,
      `Lead Details:
Naam: ${lead.name}
Phone: ${lead.phone}
Score: ${score}/10
Customer ka message: "${message}"
Time: ${new Date().toLocaleString('en-IN')}`
    );

  } else if (sentiment === 'NEGATIVE') {
    await pool.query('UPDATE leads SET status = $1 WHERE id = $2', ['not_interested', lead_id]);

    // Email notification for not interested
    const leadData2 = await pool.query('SELECT * FROM leads WHERE id = $1', [lead_id]);
    const lead2 = leadData2.rows[0];
    await sendEmail(
      process.env.ADMIN_EMAIL,
      `❌ Lead Not Interested — ${lead2.name}`,
      `Lead Details:
Naam: ${lead2.name}
Phone: ${lead2.phone}
Score: ${score}/10
Customer ka message: "${message}"
Time: ${new Date().toLocaleString('en-IN')}`
    );
  }

  // Save to call_logs with sentiment
  await pool.query(
    'INSERT INTO call_logs (lead_id, transcript, sentiment) VALUES ($1, $2, $3)',
    [lead_id, `Customer: ${message}\nAI: ${reply}`, sentiment]
  );

  res.json({ reply, sentiment, score });
});

// CSV Upload
const upload = multer({ dest: 'uploads/' });

app.post('/leads/upload-csv', upload.single('file'), async (req, res) => {
  const results = [];
  fs.createReadStream(req.file.path)
    .pipe(csv())
    .on('data', (data) => results.push(data))
    .on('end', async () => {
      let added = 0;
      for (const row of results) {
        if (row.name && row.phone) {
          await pool.query(
            'INSERT INTO leads (name, phone) VALUES ($1, $2)',
            [row.name.trim(), row.phone.trim()]
          );
          added++;
        }
      }
      fs.unlinkSync(req.file.path);
      res.json({ success: true, message: `${added} leads add ho gaye!` });
    });
});

// Campaigns
app.post('/campaigns', async (req, res) => {
  const { name, prompt } = req.body;
  const result = await pool.query(
    'INSERT INTO campaigns (name, prompt) VALUES ($1, $2) RETURNING *',
    [name, prompt]
  );
  res.json(result.rows[0]);
});

app.get('/campaigns', async (req, res) => {
  const result = await pool.query('SELECT * FROM campaigns ORDER BY created_at DESC');
  res.json(result.rows);
});

app.delete('/campaigns/:id', async (req, res) => {
  const { id } = req.params;
  await pool.query('DELETE FROM campaigns WHERE id = $1', [id]);
  res.json({ success: true });
});

// Export
app.get('/export/leads', async (req, res) => {
  const result = await pool.query('SELECT * FROM leads ORDER BY id');
  const leads = result.rows;
  let csv = 'ID,Name,Phone,Status,Score,Date\n';
  leads.forEach(lead => {
    csv += `${lead.id},"${lead.name}","${lead.phone}","${lead.status}","${lead.score || 5}","${lead.created_at}"\n`;
  });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=leads.csv');
  res.send(csv);
});

app.get('/export/call-logs', async (req, res) => {
  const result = await pool.query('SELECT * FROM call_logs ORDER BY id');
  const logs = result.rows;
  let csv = 'ID,Lead ID,Transcript,Sentiment,Date\n';
  logs.forEach(log => {
    const transcript = log.transcript ? log.transcript.replace(/"/g, "'") : '';
    csv += `${log.id},${log.lead_id},"${transcript}","${log.sentiment || ''}","${log.created_at}"\n`;
  });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=call-logs.csv');
  res.send(csv);
});

// OmniDimension se real call karo
app.post('/make-call', async (req, res) => {
  const { lead_id } = req.body;

  try {
    const leadResult = await pool.query('SELECT * FROM leads WHERE id = $1', [lead_id]);
    const lead = leadResult.rows[0];

    if (!lead) return res.status(404).json({ error: 'Lead nahi mili' });

    const response = await axios.post(
      'https://backend.omnidim.io/api/v1/calls/dispatch',
      {
        agent_id: parseInt(process.env.OMNIDIM_AGENT_ID),
        to_number: `+91${lead.phone}`,
        call_context: {
          user_name: lead.name
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.OMNIDIM_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    await pool.query(
      'INSERT INTO call_logs (lead_id, transcript) VALUES ($1, $2)',
      [lead_id, `OmniDimension call dispatched for ${lead.name}`]
    );

    res.json({ success: true, data: response.data });

  } catch (error) {
    console.log('Call error:', error.response?.data || error.message);
    res.status(500).json({ error: error.response?.data || error.message });
  }
});

app.listen(process.env.PORT, () => {
  console.log(`Server start ho gaya — port ${process.env.PORT} par`);
});