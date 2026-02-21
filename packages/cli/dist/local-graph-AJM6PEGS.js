import "./chunk-3RG5ZIWI.js";

// src/cozo-schema.ts
function initSchema(db) {
  db.run(`
    :create entities {
      key: String
      =>
      kind: String,
      name: String,
      file_path: String,
      start_line: Int default 0,
      signature: String default "",
      body: String default ""
    }
  `);
  db.run(`
    :create edges {
      from_key: String,
      to_key: String,
      type: String
    }
  `);
  db.run(`
    :create file_index {
      file_path: String,
      entity_key: String
    }
  `);
  db.run(`
    :create search_tokens {
      token: String,
      entity_key: String
    }
  `);
}

// src/search-index.ts
function tokenize(name) {
  const parts = name.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").split(/[^a-zA-Z0-9]+/).filter((p) => p.length > 0).map((p) => p.toLowerCase());
  return [...new Set(parts)];
}
function buildSearchIndex(db) {
  const result = db.run("?[key, name] := *entities[key, kind, name, fp, sl, sig, body]");
  for (const row of result.rows) {
    const [key, name] = row;
    const tokens = tokenize(name);
    for (const token of tokens) {
      try {
        db.run(
          "?[token, entity_key] <- [[$token, $key]] :put search_tokens { token, entity_key }",
          { token, key }
        );
      } catch {
      }
    }
  }
}
function searchLocal(db, query, limit = 20) {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];
  const tokenList = queryTokens.map((t) => `"${t}"`).join(", ");
  const result = db.run(`
    tokens[t] <- [[${tokenList}]]
    matched[ek, count(t)] := tokens[t], *search_tokens[t, ek]
    ?[ek, cnt, name, kind, fp] := matched[ek, cnt],
      *entities[ek, kind, name, fp, sl, sig, body]
    :order -cnt
    :limit ${limit}
  `);
  return result.rows.map((row) => {
    const [key, score, name, kind, file_path] = row;
    return { key, name, kind, file_path, score };
  });
}

// src/local-graph.ts
var CozoGraphStore = class {
  db;
  loaded = false;
  constructor(db) {
    this.db = db;
    initSchema(db);
  }
  /**
   * Load a deserialized snapshot into CozoDB.
   */
  loadSnapshot(envelope) {
    for (const entity of envelope.entities) {
      this.db.run(
        `?[key, kind, name, file_path, start_line, signature, body] <- [[$key, $kind, $name, $fp, $sl, $sig, $body]]
         :put entities { key => kind, name, file_path, start_line, signature, body }`,
        {
          key: entity.key,
          kind: entity.kind,
          name: entity.name,
          fp: entity.file_path,
          sl: entity.start_line ?? 0,
          sig: entity.signature ?? "",
          body: entity.body ?? ""
        }
      );
      this.db.run(
        `?[file_path, entity_key] <- [[$fp, $key]] :put file_index { file_path, entity_key }`,
        { fp: entity.file_path, key: entity.key }
      );
    }
    for (const edge of envelope.edges) {
      this.db.run(
        `?[from_key, to_key, type] <- [[$from, $to, $type]] :put edges { from_key, to_key, type }`,
        { from: edge.from_key, to: edge.to_key, type: edge.type }
      );
    }
    buildSearchIndex(this.db);
    this.loaded = true;
  }
  /**
   * Get a single entity by key.
   */
  getEntity(key) {
    const result = this.db.run(
      "?[key, kind, name, fp, sl, sig, body] := *entities[key, kind, name, fp, sl, sig, body], key = $key",
      { key }
    );
    if (result.rows.length === 0) return null;
    const [k, kind, name, fp, sl, sig, body] = result.rows[0];
    return { key: k, kind, name, file_path: fp, start_line: sl, signature: sig, body };
  }
  /**
   * Get all entities that call the given entity.
   */
  getCallersOf(key) {
    const result = this.db.run(
      `?[k, kind, name, fp, sl, sig, body] := *edges[from_key, $key, "calls"],
        *entities[from_key, kind, name, fp, sl, sig, body],
        k = from_key`,
      { key }
    );
    return result.rows.map((row) => {
      const [k, kind, name, fp, sl, sig, body] = row;
      return { key: k, kind, name, file_path: fp, start_line: sl, signature: sig, body };
    });
  }
  /**
   * Get all entities called by the given entity.
   */
  getCalleesOf(key) {
    const result = this.db.run(
      `?[k, kind, name, fp, sl, sig, body] := *edges[$key, to_key, "calls"],
        *entities[to_key, kind, name, fp, sl, sig, body],
        k = to_key`,
      { key }
    );
    return result.rows.map((row) => {
      const [k, kind, name, fp, sl, sig, body] = row;
      return { key: k, kind, name, file_path: fp, start_line: sl, signature: sig, body };
    });
  }
  /**
   * Get all entities in a given file.
   */
  getEntitiesByFile(filePath) {
    const result = this.db.run(
      `?[k, kind, name, fp, sl, sig, body] := *file_index[$fp, ek],
        *entities[ek, kind, name, fp, sl, sig, body],
        k = ek`,
      { fp: filePath }
    );
    return result.rows.map((row) => {
      const [k, kind, name, fp, sl, sig, body] = row;
      return { key: k, kind, name, file_path: fp, start_line: sl, signature: sig, body };
    });
  }
  /**
   * Search entities by name query.
   */
  searchEntities(query, limit = 20) {
    return searchLocal(this.db, query, limit);
  }
  /**
   * Get import edges for a file.
   */
  getImports(filePath) {
    const result = this.db.run(
      `?[from_key, to_key] := *file_index[$fp, ek],
        *edges[ek, to_key, "imports"],
        from_key = ek`,
      { fp: filePath }
    );
    return result.rows.map((row) => {
      const [from, to] = row;
      return { from, to };
    });
  }
  /**
   * Health check — always up for local store.
   */
  healthCheck() {
    return { status: "up", latencyMs: 0 };
  }
  isLoaded() {
    return this.loaded;
  }
};
export {
  CozoGraphStore
};
