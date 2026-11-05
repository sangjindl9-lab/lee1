package com.eum.safe;

import android.Manifest;
import android.app.*;
import android.os.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.provider.MediaStore;
import android.view.*;
import android.widget.*;
import androidx.core.content.FileProvider;
import java.io.File;
import java.util.*;

public class MainActivity extends Activity {
 private LinearLayout root,files;
 private Uri videoUri;
 private File pendingVideo;
 private static final int VIDEO_REQUEST=20;
 @Override public void onCreate(Bundle b){super.onCreate(b);getWindow().setStatusBarColor(Color.rgb(12,24,39));showUI();}
 private TextView label(String s,int size){TextView t=new TextView(this);t.setText(s);t.setTextSize(size);t.setTextColor(Color.WHITE);t.setPadding(8,16,8,16);return t;}
 private Button button(String text,Runnable r){Button b=new Button(this);b.setText(text);b.setAllCaps(false);b.setOnClickListener(v->r.run());return b;}
 private void showUI(){ScrollView scroll=new ScrollView(this);root=new LinearLayout(this);root.setOrientation(1);root.setPadding(30,38,30,25);root.setBackgroundColor(Color.rgb(12,24,39));scroll.addView(root);setContentView(scroll);
 root.addView(label("EUM SAFE",30));root.addView(label("호신용 증거 기록 · 시스템 녹음 표시 유지",15));
 root.addView(button("● 음성 녹음 시작",()->startAudio()));root.addView(button("■ 음성 녹음 종료",()->stopService(new Intent(this,RecordingService.class))));root.addView(button("▣ 동영상 촬영",()->startVideo()));
 root.addView(label("내 증거 파일 (길게 눌러 공유)",19));files=new LinearLayout(this);files.setOrientation(1);root.addView(files);refresh();}
 private void startAudio(){if(checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED){requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO},5);return;}if(Build.VERSION.SDK_INT>=33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},6);
 try{startForegroundService(new Intent(this,RecordingService.class));Toast.makeText(this,"녹음 시작 요청",Toast.LENGTH_SHORT).show();}catch(Exception e){Toast.makeText(this,"녹음 시작 실패: "+e.getMessage(),Toast.LENGTH_LONG).show();}}
 @Override public void onRequestPermissionsResult(int request,String[] permissions,int[] results){super.onRequestPermissionsResult(request,permissions,results);if(request==5 && results.length>0 && results[0]==PackageManager.PERMISSION_GRANTED)startAudio();}
 private void startVideo(){try{File dir=new File(getFilesDir(),"evidence");dir.mkdirs();pendingVideo=new File(dir,"VIDEO_"+System.currentTimeMillis()+".mp4");videoUri=FileProvider.getUriForFile(this,"com.eum.safe.files",pendingVideo);Intent i=new Intent(MediaStore.ACTION_VIDEO_CAPTURE);i.putExtra(MediaStore.EXTRA_OUTPUT,videoUri);i.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION|Intent.FLAG_GRANT_READ_URI_PERMISSION);startActivityForResult(i,VIDEO_REQUEST);}catch(Exception e){Toast.makeText(this,"카메라 앱 실행 불가",Toast.LENGTH_LONG).show();}}
 @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(request==VIDEO_REQUEST){if(result!=RESULT_OK && pendingVideo!=null)pendingVideo.delete();refresh();}}
 @Override protected void onResume(){super.onResume();if(files!=null)refresh();}
 private void refresh(){files.removeAllViews();File dir=new File(getFilesDir(),"evidence");File[] list=dir.listFiles();if(list==null||list.length==0){files.addView(label("아직 저장된 파일이 없습니다.",14));return;}Arrays.sort(list,(a,b)->Long.compare(b.lastModified(),a.lastModified()));for(File f:list){Button b=button(f.getName()+"  ("+(f.length()/1024)+" KB)",()->open(f));files.addView(b);b.setOnLongClickListener(v->{share(f);return true;});}}
 private void open(File f){try{Uri u=FileProvider.getUriForFile(this,"com.eum.safe.files",f);Intent i=new Intent(Intent.ACTION_VIEW);i.setDataAndType(u,f.getName().endsWith(".mp4")?"video/mp4":"audio/mp4");i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);startActivity(Intent.createChooser(i,"파일 열기"));}catch(Exception e){Toast.makeText(this,"파일 열기 앱이 없습니다.",Toast.LENGTH_SHORT).show();}}
 private void share(File f){Uri u=FileProvider.getUriForFile(this,"com.eum.safe.files",f);Intent i=new Intent(Intent.ACTION_SEND);i.setType(f.getName().endsWith(".mp4")?"video/mp4":"audio/mp4");i.putExtra(Intent.EXTRA_STREAM,u);i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);startActivity(Intent.createChooser(i,"증거 파일 공유"));}
}
