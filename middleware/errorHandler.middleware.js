import { ApiError } from "../utils/ApiError.js"

const errorHandler = (err, req, res, next) => {
  let error = err

  
  if (!(error instanceof ApiError)) {
    const statusCode = error.statusCode || error.status || 500
    const message = error.message || "Something went wrong"
    error = new ApiError(statusCode, message, error?.errors || [], err.stack)
  }

  
  if (process.env.NODE_ENV === "development") {
    console.error("Error:", {
      message: error.message,
      statusCode: error.statusCode,
      stack: error.stack,
      errors: error.errors,
    })
  }

 
  const response = {
    success: false,
    message: error.message,
    ...(process.env.NODE_ENV === "development" && { stack: error.stack }),
    ...(error.errors.length > 0 && { errors: error.errors }),
  }

  res.status(error.statusCode).json(response)
}

export { errorHandler }
