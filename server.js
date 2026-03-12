
const express = require("express")
const http = require("http")
const {Server} = require("socket.io")
const bodyParser = require("body-parser")

const apiRoutes = require("./routes/api")
const productRoutes = require("./routes/products")
const orderRoutes = require("./routes/orders")

const app = express()
const server = http.createServer(app)
const io = new Server(server)

app.use(bodyParser.json())
app.use(express.static("public"))

app.use("/api", apiRoutes)
app.use("/products", productRoutes)
app.use("/orders", orderRoutes)

io.on("connection",(socket)=>{

socket.on("cli-command",(cmd)=>{

socket.emit("cli-result","Executed: "+cmd)

})

})

server.listen(3000,()=>{

console.log("Shopee Seller Tool running on http://localhost:3000")

})
