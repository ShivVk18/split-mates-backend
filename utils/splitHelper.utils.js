import { ApiError } from "./apiError.utils"

export const getFinalSplits = (splitType,amount,splits) => {
    const finalSplits = []


    if(!Array.isArray(splits) || splits.length===0){
        throw new ApiError(400,"Split type is required")
    }

    switch(splitType){
        case "EQUAL" :{
            const equalAmount = parseFloat((amount/splits.length).toFixed(2)) 

            splits.forEach((split)=>{
                finalSplits.push({userId:split.userId,amount:equalAmount})
            })

            break;
        }


        case "EXACT" :{
             const totalExact = splits.reduce((sum,s)=>sum + parseFloat(s.amount),0)

             if (parseFloat(totalExact.toFixed(2)) !== parseFloat(amount.toFixed(2))) {
        throw new ApiError(400,"Exact split amounts must sum up to total amount");
      }   

        splits.forEach((split)=>{
                finalSplits.push({userId:split.userId,amount:parseFloat(split.amount)})
            }) 

            break;
        }


        case "PERCENTAGE" :{
            const totalPercentage = splits.reduce((sum, s) => sum + parseFloat(s.percentage), 0);

             if (parseFloat(totalPercentage.toFixed(2)) !== 100) {
        throw new ApiError(400,"Total percentage must be 100");
      }    
         
      splits.forEach((split)=> {
        const calculated = parseFloat(((split.percentage/100)*amount).toFixed(2))
        finalSplits.push({userId:split.userId,amount:calculated})
      })
          break;
        }


        case "SHARES":{
             const totalShares = splits.reduce((sum,s)=>sum+ parseFloat(s.shares),0)

             if(totalShares<=0){
                   throw new ApiError(400,"Total shares must be greater than zero");
             }

             splits.forEach((split)=> {
                const calculated = parseFloat(((split.shares/totalShares)*amount).toFixed(2))

                finalSplits.push({userId:split.userId,amount:calculated})
             })

             break;
        }


        default:
            throw new ApiError(400,"Invalid split type")
    }

    return finalSplits;
}