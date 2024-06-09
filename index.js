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
    const deliveryCollection = db.collection("deliveryDB");
    const reviewCollection = db.collection("reviews");

    // auth related api
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "365d",
      });
      res.send({ token });

      // .cookie("token", token, {
      //   httpOnly: true,
      //   secure: process.env.NODE_ENV === "production",
      //   sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
      // })
      // .send({ success: true });
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

    // verify admin middleware
    const verifyAdmin = async (req, res, next) => {
      console.log("hello");
      const user = req.user;
      const query = { email: user?.email };
      const result = await usersCollection.findOne(query);
      console.log(result.role);
      if (!result || result.role !== "admin") {
        return res.status(401).send({ message: "unauthorized access!!" });
      }
      next();
    };
    // verify deliveryman middleware
    const verifyDeliveryman = async (req, res, next) => {
      console.log("hello");
      const user = req.user;
      const query = { email: user?.email };
      const result = await usersCollection.findOne(query);
      console.log(result.role);
      if (!result || result.role !== "deliveryman") {
        return res.status(401).send({ message: "forbidden access" });
      }
      next();
    };

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

    // get user info by email from db
    app.get("/user/:email", async (req, res) => {
      const email = req.params.email;
      const result = await usersCollection.findOne({ email });
      res.send(result);
    });

    // get all user from db
    app.get("/user", async (req, res) => {
      const result = await usersCollection.find().toArray();
      res.send(result);
    });

    // update a user role
    app.patch("/user/update/:email", async (req, res) => {
      const email = req.params.email;
      const user = req.body;
      const query = { email };
      const updateDoc = {
        $set: { ...user, timeStamp: Date.now() },
      };
      const result = await usersCollection.updateOne(query, updateDoc);
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

    // get all parcel data from db with optional date range
    app.get("/allParcel", async (req, res) => {
      const { startDate, endDate } = req.query;
      let query = {};
      if (startDate && endDate) {
        query.requestedDeliveryDate = {
          $gte: new Date(startDate),
          $lte: new Date(endDate),
        };
      }
      const result = await bookParcelCollection.find(query).toArray();
      res.send(result);
    });

    // Update booking status and assign delivery man
    app.post("/updateBooking/:id", async (req, res) => {
      const id = req.params.id;
      const { deliveryManID, approximateDeliveryDate } = req.body;
      const query = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          status: "On The Way",
          deliveryManID: new ObjectId(deliveryManID),
          approximateDeliveryDate: new Date(approximateDeliveryDate),
        },
      };
      const result = await bookParcelCollection.updateOne(query, updateDoc);
      res.send(result);
    });

    // Cancel Parcel
    app.patch("/cancelParcel/:id", async (req, res) => {
      const { id } = req.params;
      const query = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: { status: "cancelled" },
      };
      try {
        const result = await bookParcelCollection.updateOne(query, updateDoc);
        // Update status in deliveryDB if the parcel was assigned to a delivery man
        if (result.modifiedCount === 1) {
          const parcelData = await bookParcelCollection.findOne(query);
          if (parcelData.deliveryManID) {
            const deliveryManQuery = { _id: parcelData.deliveryManID };
            const deliveryManUpdateDoc = {
              $inc: { deliveredParcelCount: -1 }, // Reduce deliveredParcelCount by 1
            };
            await deliveryCollection.updateOne(
              deliveryManQuery,
              deliveryManUpdateDoc
            );
          }
        }
        res.send(result);
      } catch (error) {
        console.error("Error updating parcel status:", error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    // Deliver Parcel
    app.patch("/deliverParcel/:id", async (req, res) => {
      const { id } = req.params;
      const query = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: { status: "delivered" },
      };
      try {
        const result = await bookParcelCollection.updateOne(query, updateDoc);
        // Update status in deliveryDB if the parcel was assigned to a delivery man
        if (result.modifiedCount === 1) {
          const parcelData = await bookParcelCollection.findOne(query);
          if (parcelData.deliveryManID) {
            const deliveryManQuery = { _id: parcelData.deliveryManID };
            const deliveryManUpdateDoc = {
              $inc: { deliveredParcelCount: 1 }, // Increase deliveredParcelCount by 1
            };
            await deliveryCollection.updateOne(
              deliveryManQuery,
              deliveryManUpdateDoc
            );
          }
        }
        res.send(result);
      } catch (error) {
        console.error("Error updating parcel status:", error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    // save review data in db
    app.post("/reviews", async (req, res) => {
      const reviewData = req.body;
      const result = await reviewCollection.insertOne(reviewData);
      res.send(result);
    });

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
