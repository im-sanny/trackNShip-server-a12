const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const express = require("express");
const app = express();
const cors = require("cors");
require("dotenv").config();
const jwt = require("jsonwebtoken");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const port = process.env.PORT || 8000;

const corsOptions = {
  origin: [
    "http://localhost:5173",
    "https://tracknship22.web.app",
    "https://tracknship22.firebaseapp.com",
  ],
  credentials: true,
  optionSuccessStatus: 200,
};
app.use(cors(corsOptions));
app.use(express.json());

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
    const reviewCollection = db.collection("reviews");
    const paymentCollection = db.collection("payments");

    // jwt related api
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "365d",
      });
      res.send({ token });
    });

    // middlewares
    const verifyToken = (req, res, next) => {
      // console.log("inside verify token", req.headers.authorization);
      if (!req.headers.authorization) {
        return res.status(401).send({ message: "forbidden access" });
      }
      const token = req.headers.authorization.split(" ")[1];
      jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
          return res.status(401).send({ message: "forbidden access" });
        }
        req.decoded = decoded;
        next();
      });
    };

    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      const isAdmin = user?.role === "admin";
      if (!isAdmin) {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    // verify deliveryman middleware
    const verifyDeliveryman = async (req, res, next) => {
      console.log("hello");
      const email = req.decoded.email;
      const query = { email: email };
      const result = await usersCollection.findOne(query);
      console.log(result.role);
      if (!result || result.role !== "deliveryman") {
        return res.status(401).send({ message: "forbidden access" });
      }
      next();
    };

    // Endpoint to fetch top delivery men
    app.get("/deliverymen", async (req, res) => {
      try {
        const deliveryCollection = db.collection("users"); // Assuming delivery men are stored in the "users" collection

        // Fetch users with role "deliveryman" from the database
        const deliveryMen = await deliveryCollection
          .find({ role: "deliveryman" })
          .toArray();

        // Calculate the number of parcels delivered and average ratings for each delivery man
        const deliveryMenData = await Promise.all(
          deliveryMen.map(async (deliveryMan) => {
            const { _id, name } = deliveryMan;
            const parcelCount = await bookParcelCollection.countDocuments({
              deliveryManID: _id,
            });
            const reviews = await reviewCollection
              .find({ deliveryManID: _id })
              .toArray();
            const totalRating = reviews.reduce(
              (acc, review) => acc + review.rating,
              0
            );
            const averageRating =
              reviews.length > 0 ? totalRating / reviews.length : 0;
            return { _id, name, parcelCount, averageRating };
          })
        );

        //     // Sort delivery men by the number of parcels delivered and average ratings
        const topDeliveryMen = deliveryMenData
          .sort((a, b) => {
            if (a.parcelCount !== b.parcelCount) {
              return b.parcelCount - a.parcelCount;
            }
            return b.averageRating - a.averageRating;
          })
          .slice(0, 3); // Get the top 3 delivery men

        // Send the top delivery men data as response
        res.json(topDeliveryMen);
      } catch (error) {
        console.error("Error fetching top delivery men:", error);
        res.status(500).json({ error: "Internal Server Error" });
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
    app.patch(
      "/user/update/:email",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const email = req.params.email;
        const user = req.body;
        const query = { email };
        const updateDoc = {
          $set: { ...user, timeStamp: Date.now() },
        };
        const result = await usersCollection.updateOne(query, updateDoc);
        res.send(result);
      }
    );

    // save book parcel data in db
    app.post("/bookParcel",verifyToken, async (req, res) => {
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
    app.post(
      "/updateBooking/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
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
      }
    );

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
            await bookParcelCollection.updateOne(
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
    app.patch("/deliverParcel/:id",verifyToken, async (req, res) => {
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
            await bookParcelCollection.updateOne(
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

    // get all review
    app.get("/reviews", async (req, res) => {
      const result = await reviewCollection.find().toArray();
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

    // update after successfull payment
    app.patch("/getUpdateStatus/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: { price: "paid" }, // Update the price field to "paid"
        };
        const result = await bookParcelCollection.updateOne(query, updateDoc);
        res.send(result);
      } catch (error) {
        console.error("Error updating booking data:", error);
        res.status(500).send("Internal Server Error");
      }
    });

    app.post("/create-payment-intent", async (req, res) => {
      const { price } = req.body;
      const amount = parseInt(price * 100);
      console.log("Amount in cents:", amount);

      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amount,
          currency: "usd",
          payment_method_types: ["card"],
        });
        res.send({
          clientSecret: paymentIntent.client_secret,
        });
      } catch (error) {
        console.error("Error creating payment intent:", error);
        res.status(500).send({ error: error.message });
      }
    });

    // create-payment-intent
    app.post("/create-payment-intent", async (req, res) => {
      const price = req.body.price;
      const priceInCent = parseFloat(price) * 100;
      console.log("priceInCent", priceInCent);
      if (!price || priceInCent < 1) return;
      // generate clientSecret
      const { client_secret } = await stripe.paymentIntents.create({
        amount: priceInCent,
        currency: "usd",
        automatic_payment_methods: {
          enabled: true,
        },
      });
      // send client secret as response
      res.send({ clientSecret: client_secret });
    });

    // payment related api
    app.post("/payments", async (req, res) => {
      const payment = req.body;
      const paymentResult = await paymentCollection.insertOne(payment);
      console.log("payment info", payment);
      res.send(paymentResult);
    });

    // await client.db("admin").command({ ping: 1 });
    // console.log(
    //   "Pinged your deployment. You successfully connected to MongoDB!"
    // );
  } finally {
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello from TrackNShip.....!!!");
});

app.listen(port, () => console.log(`Server running on port ${port}`));
