package com.eum.safe;

import android.app.*;
import android.content.*;
import android.media.MediaRecorder;
import android.os.*;
import java.io.File;
import java.text.SimpleDateFormat;
import java.util.*;

public class RecordingService extends Service {
 public static final String CHANNEL="eum_recording";
 private MediaRecorder recorder;
 private File output;
 @Override public void onCreate(){super.onCreate(); NotificationChannel ch=new NotificationChannel(CHANNEL,"녹음 상태",NotificationManager.IMPORTANCE_LOW); ((NotificationManager)getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(ch);}
 @Override public int onStartCommand(Intent intent,int flags,int startId){
  if(intent!=null && "STOP".equals(intent.getAction())){stopRecording();stopSelf();return START_NOT_STICKY;}
  if(recorder!=null)return START_STICKY;
  Intent stop=new Intent(this,RecordingService.class).setAction("STOP");
  PendingIntent pi=PendingIntent.getService(this,1,stop,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
  Notification n=new Notification.Builder(this,CHANNEL).setContentTitle("EUM SAFE 음성 녹음 중").setContentText("마이크 사용 중 · 종료하려면 중지 선택").setSmallIcon(android.R.drawable.ic_btn_speak_now).setOngoing(true).addAction(new Notification.Action.Builder(null,"녹음 중지",pi).build()).build();
  if(Build.VERSION.SDK_INT>=29)startForeground(10,n,android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE); else startForeground(10,n);
  try {File dir=new File(getFilesDir(),"evidence");dir.mkdirs();String name="AUDIO_"+new SimpleDateFormat("yyyyMMdd_HHmmss",Locale.KOREA).format(new Date())+".m4a";output=new File(dir,name);
   recorder=new MediaRecorder();recorder.setAudioSource(MediaRecorder.AudioSource.MIC);recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);recorder.setAudioEncodingBitRate(128000);recorder.setAudioSamplingRate(44100);recorder.setOutputFile(output.getAbsolutePath());recorder.prepare();recorder.start();
  }catch(Exception e){stopRecording();stopSelf();}return START_NOT_STICKY;
 }
 private void stopRecording(){if(recorder!=null){try{recorder.stop();}catch(Exception e){if(output!=null)output.delete();}recorder.reset();recorder.release();recorder=null;}stopForeground(STOP_FOREGROUND_REMOVE);}
 @Override public void onDestroy(){stopRecording();super.onDestroy();}
 @Override public IBinder onBind(Intent i){return null;}
}
