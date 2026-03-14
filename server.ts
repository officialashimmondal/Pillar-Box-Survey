import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { google } from "googleapis";
import cookieSession from "cookie-session";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(
  cookieSession({
    name: "session",
    keys: [process.env.SESSION_SECRET || "default-secret-key"],
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    secure: true,
    sameSite: "none",
  })
);

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  `${process.env.APP_URL || 'http://localhost:3000'}/auth/google/callback`
);

// Auth URL endpoint
app.get("/api/auth/google/url", (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive.file",
    ],
    prompt: "consent",
  });
  res.json({ url });
});

// OAuth Callback
app.get("/auth/google/callback", async (req, res) => {
  const { code } = req.query;
  try {
    const { tokens } = await oauth2Client.getToken(code as string);
    req.session!.tokens = tokens;
    
    res.send(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'GOOGLE_AUTH_SUCCESS' }, '*');
              window.close();
            } else {
              window.location.href = '/';
            }
          </script>
          <p>Authentication successful. You can close this window.</p>
        </body>
      </html>
    `);
  } catch (error) {
    console.error("Error exchanging code for tokens:", error);
    res.status(500).send("Authentication failed");
  }
});

// Check status
app.get("/api/auth/google/status", (req, res) => {
  res.json({ connected: !!req.session?.tokens });
});

// Logout
app.post("/api/auth/google/logout", (req, res) => {
  req.session = null;
  res.json({ success: true });
});

// Append to sheet
app.post("/api/surveys/sync-sheet", async (req, res) => {
  if (!req.session?.tokens) {
    return res.status(401).json({ error: "Not connected to Google Sheets" });
  }

  const { surveyData, spreadsheetId: providedId } = req.body;
  oauth2Client.setCredentials(req.session.tokens);

  const sheets = google.sheets({ version: "v4", auth: oauth2Client });

  try {
    let spreadsheetId = providedId;

    if (!spreadsheetId) {
      // 1. Find or create a spreadsheet named "PB Survey Data"
      const drive = google.drive({ version: "v3", auth: oauth2Client });
      const response = await drive.files.list({
        q: "name = 'PB Survey Data' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false",
        fields: "files(id, name)",
      });
      spreadsheetId = response.data.files?.[0]?.id;
    }

    if (!spreadsheetId) {
      const resource = {
        properties: {
          title: "PB Survey Data",
        },
      };
      const spreadsheet = await sheets.spreadsheets.create({
        requestBody: resource,
        fields: "spreadsheetId",
      });
      spreadsheetId = spreadsheet.data.spreadsheetId!;
    }

    // Check if headers exist, if not add them
    try {
      const sheetMetadata = await sheets.spreadsheets.get({
        spreadsheetId,
      });
      const sheetName = sheetMetadata.data.sheets?.[0]?.properties?.title || "Sheet1";
      
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${sheetName}!A1:A1`,
      });

      if (!response.data.values || response.data.values.length === 0) {
        const headers = [
          "Surveyor Name", "Date", "Pillar Box Name", "Category", "Type", "Size", 
          "Door Condition", "Base Plate", "Blank Off", "Lock", "Door Status", 
          "Hinge Broken", "Inclined", "Raising Req", "Garbage", "Address", "Findings", "Timestamp"
        ];
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `${sheetName}!A1`,
          valueInputOption: "RAW",
          requestBody: {
            values: [headers],
          },
        });
      }
    } catch (e) {
      console.error("Error checking/adding headers", e);
    }

    // 2. Append the data
    const row = [
      surveyData.surveyorName,
      surveyData.surveyDate,
      surveyData.pillarBoxName,
      surveyData.category,
      surveyData.pillarType,
      surveyData.pillarSize,
      surveyData.doorCondition,
      surveyData.basePlateCondition,
      surveyData.blankOff,
      surveyData.lock,
      surveyData.doorStatus,
      surveyData.hingeBroken ? "YES" : "NO",
      surveyData.pbInclined ? "YES" : "NO",
      surveyData.raisingRequired ? "YES" : "NO",
      surveyData.garbageBlockage ? "YES" : "NO",
      surveyData.pbAddress,
      surveyData.findings,
      new Date().toISOString()
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "A2", // Append to the first sheet
      valueInputOption: "RAW",
      requestBody: {
        values: [row],
      },
    });

    res.json({ success: true, spreadsheetId });
  } catch (error) {
    console.error("Error syncing to sheet:", error);
    res.status(500).json({ error: "Failed to sync to Google Sheets" });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
