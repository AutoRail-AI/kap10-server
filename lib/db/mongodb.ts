import { MongoClient, type Db, type Collection, type Document } from "mongodb"

declare global {
  // eslint-disable-next-line no-var
  var _mongoClientPromise: Promise<MongoClient> | undefined
}

const MONGODB_URI = process.env.MONGODB_URI

if (!MONGODB_URI) {
  console.warn("MONGODB_URI is not defined in environment variables")
}

let client: MongoClient
let clientPromise: Promise<MongoClient>

function getClientPromise(): Promise<MongoClient> {
  if (!MONGODB_URI) {
    throw new Error(
      "Please define the MONGODB_URI environment variable inside .env.local"
    )
  }

  if (process.env.NODE_ENV === "development") {
    // In development, use a global variable to preserve connection across hot reloads
    if (!global._mongoClientPromise) {
      client = new MongoClient(MONGODB_URI)
      global._mongoClientPromise = client.connect()
    }
    return global._mongoClientPromise
  }

  // In production, don't use a global variable
  if (!clientPromise) {
    client = new MongoClient(MONGODB_URI)
    clientPromise = client.connect()
  }
  return clientPromise
}

export async function getDb(): Promise<Db> {
  const client = await getClientPromise()
  return client.db("appealgen")
}

export async function getCollection<T extends Document>(
  name: string
): Promise<Collection<T>> {
  const db = await getDb()
  return db.collection<T>(name)
}

export default getClientPromise
