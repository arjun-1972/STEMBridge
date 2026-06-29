const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = __dirname;
const dbPath = path.join(root, "database.json");
const port = Number(process.env.PORT || 4176);

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png"
};

function readDb() {
  return JSON.parse(fs.readFileSync(dbPath, "utf8"));
}

function writeDb(db) {
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
}

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function matchesQuery(item, query) {
  const normalized = query.toLowerCase();
  const haystack = [
    item.type,
    item.title,
    item.org,
    item.deadline,
    item.description,
    ...(item.tags || [])
  ].join(" ").toLowerCase();
  const words = normalized
    .split(/\s+/)
    .map((word) => word.replace(/[^a-z0-9]/g, ""))
    .filter((word) => word.length > 1);
  return haystack.includes(normalized) || words.some((word) => {
    const singular = word.endsWith("s") ? word.slice(0, -1) : word;
    return haystack.includes(word) || haystack.includes(singular);
  });
}

async function handleApi(req, res, url) {
  const db = readDb();

  if (req.method === "GET" && url.pathname === "/api/catalog") {
    sendJson(res, 200, { catalog: db.catalog, deadlines: db.deadlines });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/search") {
    const query = url.searchParams.get("q") || "";
    const allItems = [...db.catalog, ...db.deadlines];
    sendJson(res, 200, { results: query ? allItems.filter((item) => matchesQuery(item, query)) : allItems });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/saved") {
    sendJson(res, 200, { saved: db.saved });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/users") {
    const input = await readBody(req);
    const email = String(input.email || "").trim().toLowerCase();
    if (!email || !email.includes("@")) {
      sendJson(res, 400, { error: "A valid email is required." });
      return;
    }

    const existing = db.users.find((user) => user.email === email);
    if (input.mode === "signup" && !existing) {
      db.users.push({
        id: crypto.randomUUID(),
        name: String(input.name || "").trim(),
        email,
        interest: String(input.interest || "").trim(),
        createdAt: new Date().toISOString()
      });
      writeDb(db);
    }

    sendJson(res, 200, { ok: true, user: db.users.find((user) => user.email === email) || { email } });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/saved") {
    const input = await readBody(req);
    const title = String(input.title || "").trim();
    if (!title) {
      sendJson(res, 400, { error: "A title is required." });
      return;
    }

    const savedItem = {
      id: crypto.randomUUID(),
      title,
      type: String(input.type || "opportunity"),
      source: String(input.source || "webpage"),
      savedAt: new Date().toISOString()
    };
    db.saved.push(savedItem);
    writeDb(db);
    sendJson(res, 200, { ok: true, saved: savedItem });
    return;
  }

  sendJson(res, 404, { error: "API route not found." });
}

function serveStatic(req, res, url) {
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const file = path.resolve(root, `.${decodeURIComponent(requested)}`);
  const resolvedRoot = path.resolve(root);

  if (!file.startsWith(resolvedRoot)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(file, (error, body) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    res.writeHead(200, { "Content-Type": contentTypes[path.extname(file)] || "application/octet-stream" });
    res.end(body);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    serveStatic(req, res, url);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Server error" });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`STEMBridge server running at http://127.0.0.1:${port}`);
});
