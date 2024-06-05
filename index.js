const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const express = require("express");
const app = express();
const cors = require("cors");
require("dotenv").config();
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");

const port = process.env.PORT || 8000;

const corsOptions = {
  origin: ["http://localhost:5173", "http://localhost:5174"],
  credentials: true,
  optionSuccessStatus: 200,
};
app.use(cors(corsOptions));

app.use(express.json());
app.use(cookieParser());

// verify token middleWare
const verifyToken = async (req, res, next) => {
  const token = req.cookies?.token;
  console.log(token);
  if (!token) {
    return res.status(401).send({ message: "unauthorized access" });
  }
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      console.log(err);
      return res.status(401).send({ message: "unauthorized access" });
    }
    req.user = decoded;
    next();
  });
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.96corz1.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    const db = client.db("tracknship");
    const bookParcelCollection = db.collection("bookParcel");
    const usersCollection = db.collection("users");
    // auth related api
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "365d",
      });
      res
        .cookie("token", token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
        })
        .send({ success: true });
    });
    // Logout
    app.get("/logout", async (req, res) => {
      try {
        res
          .clearCookie("token", {
            maxAge: 0,
            secure: process.env.NODE_ENV === "production",
            sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
          })
          .send({ success: true });
        console.log("Logout successful");
      } catch (err) {
        res.status(500).send(err);
      }
    });

    // save all user data in db
    app.put("/user", async (req, res) => {
      const user = req.body;
      const query = { email: user?.email };

      // check if user already exists in db
      const isExists = await usersCollection.findOne(query);
      if (isExists) {
        if (user.status === "Requested") {
          // if existing user login again
          const result = await usersCollection.updateOne(query, {
            $set: { status: user?.status },
          });
          return res.send(result);
        } else {
          // if existing user login again
          return res.send(isExists);
        }
      }

      // save user for  first time
      const options = { upsert: true };
      const updateDoc = {
        $set: {
          ...user,
          timeStamp: Date.now(),
        },
      };
      const result = await usersCollection.updateOne(query, updateDoc, options);
      res.send(result);
    });

    // get all user from db
    app.get("/allUser", async (req, res) => {
      const result = await usersCollection.find().toArray();
      res.send(result);
    });

    // save book parcel data in db
    app.post("/bookParcel", async (req, res) => {
      const bookParcelData = req.body;
      const result = await bookParcelCollection.insertOne(bookParcelData);
      res.send(result);
    });

    // all book parcel data which are submitted by the specific user
    app.get("/myParcel/:email", async (req, res) => {
      const email = req.params.email;
      const query = { "normalUser.email": email };
      const result = await bookParcelCollection.find(query).toArray();
      res.send(result);
    });

    // app.get("/bookParcel/:email", verifyToken, async (req, res) => {
    //   const email = req.params.email;
    //   const query = { email };
    //   const result = await bookParcelCollection.find(query).toArray();
    //   res.send(result);
    // });

    // get all pending booking
    // app.get("/bookParcel-all", async (req, res) => {
    //   const result = await bookParcelCollection.find().toArray();
    //   res.send(result);
    // });

    // delete booking upon canceling the booking
    app.delete("/cancelParcel/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await bookParcelCollection.deleteOne(query);
      res.send(result);
    });

    // get data of single id before update
    app.get("/getUpdate/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await bookParcelCollection.findOne(query);
      res.send(result);
    });

    // update a booking data
    app.patch("/getUpdate/:id", async (req, res) => {
      const id = req.params.id;
      const parcelData = req.body;
      const query = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: parcelData,
      };
      const result = await bookParcelCollection.updateOne(query, updateDoc);
      res.send(result);
    });

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello from TrackNShip.....!!!");
});

app.listen(port, () => console.log(`Server running on port ${port}`));
