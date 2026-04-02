package com.selton.studio.plugins;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.media.projection.MediaProjectionManager;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Capacitor plugin that bridges Android MediaProjection to JavaScript.
 *
 * JS API (via src/plugins/screenCapture.ts):
 *   ScreenCapture.startCapture({ width, height, fps })
 *   ScreenCapture.addListener('frameReady', ({ jpeg }) => ...)
 *   ScreenCapture.stopCapture()
 */
@CapacitorPlugin(name = "ScreenCapture")
public class ScreenCapturePlugin extends Plugin {

    @PluginMethod
    public void startCapture(PluginCall call) {
        // Keep the call alive across the activity result
        call.setKeepAlive(true);

        MediaProjectionManager mgr = (MediaProjectionManager)
                getContext().getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        Intent permissionIntent = mgr.createScreenCaptureIntent();
        startActivityForResult(call, permissionIntent, "handleMediaProjectionResult");
    }

    @ActivityCallback
    private void handleMediaProjectionResult(PluginCall call, com.getcapacitor.ActivityResult result) {
        if (result.getResultCode() != Activity.RESULT_OK) {
            call.reject("Screen capture permission denied");
            return;
        }

        int    width  = call.getInt("width",  1280);
        int    height = call.getInt("height", 720);
        int    fps    = call.getInt("fps",    15);

        // Register callback BEFORE starting the service
        ScreenCaptureService.setCallback(this::onFrameReady);

        Intent serviceIntent = new Intent(getContext(), ScreenCaptureService.class);
        serviceIntent.setAction(ScreenCaptureService.ACTION_START);
        serviceIntent.putExtra(ScreenCaptureService.EXTRA_RESULT_CODE, result.getResultCode());
        serviceIntent.putExtra(ScreenCaptureService.EXTRA_RESULT_DATA, result.getData());
        serviceIntent.putExtra(ScreenCaptureService.EXTRA_WIDTH,  width);
        serviceIntent.putExtra(ScreenCaptureService.EXTRA_HEIGHT, height);
        serviceIntent.putExtra(ScreenCaptureService.EXTRA_FPS,    fps);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getContext().startForegroundService(serviceIntent);
        } else {
            getContext().startService(serviceIntent);
        }

        call.resolve();
    }

    @PluginMethod
    public void stopCapture(PluginCall call) {
        ScreenCaptureService.setCallback(null);

        Intent serviceIntent = new Intent(getContext(), ScreenCaptureService.class);
        serviceIntent.setAction(ScreenCaptureService.ACTION_STOP);
        getContext().startService(serviceIntent);

        call.resolve();
    }

    /** Fired from ScreenCaptureService background thread for each JPEG frame */
    private void onFrameReady(String base64Jpeg) {
        JSObject data = new JSObject();
        data.put("jpeg", base64Jpeg);
        notifyListeners("frameReady", data);
    }
}
