import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

export const connectDB = async () =>{
    if(mongoose.connections[0].readyState){
        return true;
    }

    try {
        await mongoose.connect(process.env.MONGO_DB_URL);
        console.log('MongoDb connected');
        return true;
        
    } catch (error) {
        console.log(error);
    }
}