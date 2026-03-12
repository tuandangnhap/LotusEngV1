
const socket = io()

function show(page){

["dashboard","cli","products","orders"].forEach(p=>{
document.getElementById(p).style.display="none"
})

document.getElementById(page).style.display="block"

}

const input = document.getElementById("cmd")
const output = document.getElementById("output")

if(input){

input.addEventListener("keypress",(e)=>{

if(e.key==="Enter"){

const cmd = input.value

output.innerHTML += "\n> "+cmd

socket.emit("cli-command",cmd)

input.value=""

}

})

}

socket.on("cli-result",(data)=>{

output.innerHTML += "\n"+data

})

async function loadProducts(){

const res = await fetch("/products")

const data = await res.json()

document.getElementById("productResult").textContent = JSON.stringify(data,null,2)

}

async function loadOrders(){

const res = await fetch("/orders")

const data = await res.json()

document.getElementById("orderResult").textContent = JSON.stringify(data,null,2)

}
