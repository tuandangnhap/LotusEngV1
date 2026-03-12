
const express = require("express")
const router = express.Router()

router.get("/",(req,res)=>{

res.json({
message:"Product list endpoint placeholder"
})

})

router.post("/update",(req,res)=>{

res.json({
status:"product updated",
data:req.body
})

})

module.exports = router
