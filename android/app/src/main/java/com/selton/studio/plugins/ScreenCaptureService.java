package com.selton.studio.plugins;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.util.Base64;

import androidx.core.app.NotificationCompat;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;

/**
 * Foreground Service that drives the MediaProjection → VirtualDisplay → ImageReader → JPEG pipeline.
 *
 * Android 10+ requires MediaProjection to run inside a foreground service.
 * This service starts a persistent notification so the OS permits the projection.
 *
 * Communicates back to ScreenCapturePlugin via a static callback (single-session pattern).
 */
public class ScreenCaptureService extends Service {

    public static final String ACTION_START = "com.selton.studio.START_CAPTURE";
    public static final String ACTION_STOP  = "com.selton.studio.STOP_CAPTURE";

    public static final String EXTRA_RESULT_CODE = "resultCode";
    public static final String EXTRA_RESULT_DATA = "resultData";
    public static final String EXTRA_WIDTH        = "width";
    public static final String EXTRA_HEIGHT       = "height";
    public static final String EXTRA_FPS          = "fps";

    private static final String CHANNEL_ID = "aether_screencap";
    private static final int    NOTIF_ID   = 7001;

    public interface FrameCallback {
        void onFrame(String base64Jpeg);
    }

    /** Set by ScreenCapturePlugin before starting this service. */
    private static volatile FrameCallback frameCallback;

    public static void setCallback(FrameCallback cb) {
        frameCallback = cb;
    }

    // ── capture state ──────────────────────────────────────────────────────────

    private MediaProjection mediaProjection;
    private VirtualDisplay  virtualDisplay;
    private ImageReader     imageReader;
    private HandlerThread   handlerThread;
    private Handler         handler;
    private volatile boolean running = false;

    // ── Service lifecycle ──────────────────────────────────────────────────────

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || ACTION_STOP.equals(intent.getAction())) {
            stopCapture();
            stopSelf();
            return START_NOT_STICKY;
        }

        createNotificationChannel();
        Notification notif = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("AetherCast")
                .setContentText("Screen sharing to Studio…")
                .setSmallIcon(android.R.drawable.ic_menu_share)
                .setOngoing(true)
                .build();
        startForeground(NOTIF_ID, notif);

        int    resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, 0);
        Intent resultData = intent.getParcelableExtra(EXTRA_RESULT_DATA);
        int    width      = intent.getIntExtra(EXTRA_WIDTH,  1280);
        int    height     = intent.getIntExtra(EXTRA_HEIGHT, 720);
        int    fps        = intent.getIntExtra(EXTRA_FPS,    15);

        startCapture(resultCode, resultData, width, height, fps);
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        stopCapture();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null; // not a bound service
    }

    // ── Capture logic ──────────────────────────────────────────────────────────

    private void startCapture(int resultCode, Intent resultData, int width, int height, int fps) {
        handlerThread = new HandlerThread("ScreenCapture");
        handlerThread.start();
        handler = new Handler(handlerThread.getLooper());

        MediaProjectionManager mgr = (MediaProjectionManager)
                getSystemService(MEDIA_PROJECTION_SERVICE);
        mediaProjection = mgr.getMediaProjection(resultCode, resultData);

        imageReader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2);
        virtualDisplay = mediaProjection.createVirtualDisplay(
                "AetherScreenCapture",
                width,
                height,
                getResources().getDisplayMetrics().densityDpi,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                imageReader.getSurface(),
                null,
                null
        );

        running = true;
        long intervalMs = 1000L / fps;
        scheduleFrame(intervalMs);
    }

    private void scheduleFrame(long intervalMs) {
        if (!running || handler == null) return;
        handler.postDelayed(() -> {
            captureFrame();
            scheduleFrame(intervalMs);
        }, intervalMs);
    }

    private void captureFrame() {
        if (imageReader == null) return;
        Image image = imageReader.acquireLatestImage();
        if (image == null) return;

        try {
            Image.Plane[] planes  = image.getPlanes();
            ByteBuffer    buffer  = planes[0].getBuffer();
            int pixelStride       = planes[0].getPixelStride();
            int rowStride         = planes[0].getRowStride();
            int rowPadding        = rowStride - pixelStride * image.getWidth();

            Bitmap bitmap = Bitmap.createBitmap(
                    image.getWidth() + rowPadding / pixelStride,
                    image.getHeight(),
                    Bitmap.Config.ARGB_8888
            );
            bitmap.copyPixelsFromBuffer(buffer);

            Bitmap cropped = Bitmap.createBitmap(bitmap, 0, 0, image.getWidth(), image.getHeight());
            bitmap.recycle();

            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            cropped.compress(Bitmap.CompressFormat.JPEG, 60, baos);
            cropped.recycle();

            String base64 = Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP);
            if (frameCallback != null) frameCallback.onFrame(base64);
        } finally {
            image.close();
        }
    }

    private void stopCapture() {
        running = false;
        if (virtualDisplay  != null) { virtualDisplay.release();   virtualDisplay  = null; }
        if (mediaProjection != null) { mediaProjection.stop();     mediaProjection = null; }
        if (imageReader     != null) { imageReader.close();        imageReader     = null; }
        if (handlerThread   != null) { handlerThread.quitSafely(); handlerThread   = null; }
        handler = null;
    }

    // ── Notification channel ───────────────────────────────────────────────────

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(
                    CHANNEL_ID,
                    "Screen Capture",
                    NotificationManager.IMPORTANCE_LOW
            );
            ch.setDescription("AetherCast screen sharing session");
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.createNotificationChannel(ch);
        }
    }
}
