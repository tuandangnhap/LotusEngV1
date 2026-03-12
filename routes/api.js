
const express = require("express")
const router = express.Router()
const callAPI = require("../services/request")

router.get("/call", async (req,res)=>{

try{

const path = req.query.path
const result = await callAPI(path,req.query)

res.json(result)

}catch(e){

res.json({error:e.message})

}

})

module.exports = router
