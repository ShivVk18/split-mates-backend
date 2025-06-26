import express  from 'express'
import cors from 'cors'
import { errorHandler } from './middleware/errorHandler.middleware.js'

const app = express()


app.use(cors({
    origin:process.env.CORS_ORIGIN
}))

app.use(express.json({limit:'16kb'}))
app.use(express.urlencoded({
     extended:true,limit:'16kb'
}))

app.use(express.static('public'))
app.use(cookieParser())



app.use(errorHandler)

export{app}