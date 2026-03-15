import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import ffmpeg from "fluent-ffmpeg";
import { PassThrough } from "stream";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    },
    maxHttpBufferSize: 1e8 // 100MB for video chunks
  });

  const PORT = 3000;

  // Socket.io Signaling & Streaming
  io.on("connection", (socket) => {
    console.log("User connected:", socket.id);
    let ffmpegProcess: any = null;
    let inputStream: any = null;

    socket.on("join-room", (roomId) => {
      socket.join(roomId);
      console.log(`User ${socket.id} joined room ${roomId}`);
      socket.to(roomId).emit("user-joined", socket.id);
    });

    socket.on("signal", (data) => {
      if (data.to) {
        io.to(data.to).emit("signal", { from: socket.id, signal: data.signal });
      } else {
        socket.to(data.roomId).emit("signal", { from: socket.id, signal: data.signal });
      }
    });

    // RTMP Streaming Logic
    socket.on("start-stream", (data) => {
      const { destinations } = data;
      if (!destinations || destinations.length === 0) {
        socket.emit('server-log', { message: 'No destinations provided', type: 'error' });
        return;
      }
      
      console.log(`Streaming started to ${destinations.length} destinations`);
      socket.emit('server-log', { message: `Initializing FFmpeg for ${destinations.length} destinations...`, type: 'info' });

      inputStream = new PassThrough();
      
      let command = ffmpeg(inputStream)
        .inputFormat('webm')
        // Use libx264 as a safe default, but in a real production environment, 
        // you would detect and use hardware encoders like h264_nvenc, h264_qsv, or h264_videotoolbox
        .videoCodec('libx264')
        .audioCodec('aac')
        .outputOptions([
          '-preset veryfast', // Better quality than ultrafast, still low latency
          '-tune zerolatency',
          '-threads 0', // Use all available CPU threads
          '-g 60', // 2 second keyframe at 30fps (required by Twitch/YouTube)
          '-keyint_min 60',
          '-sc_threshold 0', // Disable scene change detection for strict CBR
          '-b:v 6000k', // 6Mbps for 1080p60 broadcast quality
          '-maxrate 6000k',
          '-bufsize 12000k', // 2x maxrate for buffer
          '-pix_fmt yuv420p',
          '-profile:v high',
          '-level 4.2',
          '-b:a 160k', // High quality audio
          '-ar 44100'
        ]);

      // Construct tee output with failure isolation
      let teeOutputs = '';
      destinations.forEach((dest: any) => {
        const url = `${dest.rtmpUrl.replace(/\/$/, '')}/${dest.streamKey}`;
        // onfail=ignore ensures if one destination drops, the others keep streaming
        teeOutputs += `[f=flv:onfail=ignore]${url}|`;
      });
      // Remove trailing pipe
      teeOutputs = teeOutputs.slice(0, -1);

      command = command
        .format('tee')
        .outputOptions([
          '-map 0:v',
          '-map 0:a?', // Map audio if available
          '-flags +global_header' // Required for some RTMP destinations when using tee
        ])
        .output(teeOutputs);

      ffmpegProcess = command
        .on('start', (commandLine) => {
          console.log('FFmpeg started with command: ' + commandLine);
          socket.emit('server-log', { message: 'FFmpeg started successfully', type: 'success' });
        })
        .on('stderr', (stderrLine) => {
          // console.log('FFmpeg output: ' + stderrLine); // Too noisy
          // socket.emit('server-log', { message: stderrLine, type: 'ffmpeg' });
        })
        .on('error', (err, stdout, stderr) => {
          console.error('FFmpeg error:', err.message);
          socket.emit('server-log', { message: `FFmpeg Error: ${err.message}`, type: 'error' });
        })
        .on('end', () => {
          console.log('FFmpeg process ended');
          socket.emit('server-log', { message: 'FFmpeg process ended', type: 'info' });
        });
        
      ffmpegProcess.run();
    });

    socket.on("audience-message", (data) => {
      if (data.roomId) {
        socket.to(data.roomId).emit("audience-message", data.message);
      }
    });

    socket.on("stream-chunk", (data) => {
      if (inputStream) {
        inputStream.write(Buffer.from(data.chunk));
      }
    });

    socket.on("stop-stream", () => {
      if (ffmpegProcess) {
        ffmpegProcess.kill('SIGINT');
        ffmpegProcess = null;
        inputStream = null;
        console.log('Streaming stopped');
      }
    });

    socket.on("disconnect", () => {
      console.log("User disconnected:", socket.id);
      if (ffmpegProcess) {
        ffmpegProcess.kill('SIGINT');
      }
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { 
        middlewareMode: true,
        hmr: false 
      },
      appType: "spa",
    });
    
    app.use(vite.middlewares);

    // Serve index.html for all non-API routes in dev
    app.use('*', async (req, res, next) => {
      const url = req.originalUrl;
      console.log(`Server: Handling request for ${url}`);
      try {
        const indexPath = path.resolve(__dirname, 'index.html');
        console.log(`Server: Reading index.html from ${indexPath}`);
        let template = fs.readFileSync(indexPath, 'utf-8');
        template = await vite.transformIndexHtml(url, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
      } catch (e) {
        console.error(`Server: Error serving index.html:`, e);
        vite.ssrFixStacktrace(e as Error);
        next(e);
      }
    });
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
