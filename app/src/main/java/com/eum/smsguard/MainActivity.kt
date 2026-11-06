package com.eum.smsguard

import android.app.Activity
import android.os.Bundle
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import android.graphics.Color
import android.view.View
import android.widget.*

class MainActivity:Activity() {
 private lateinit var root:LinearLayout
 private val prefs by lazy { getSharedPreferences("settings",MODE_PRIVATE) }
 private val store by lazy { Store(this) }
 private fun label(s:String,size:Float=16f):TextView = TextView(this).apply { text=s;textSize=size;setTextColor(Color.rgb(30,40,55));setPadding(10,12,10,12) }
 private fun button(s:String, action:()->Unit) { root.addView(Button(this).apply {text=s;setOnClickListener{action()} }) }
 private fun edit(hint:String,value:String=""):EditText=EditText(this).apply{this.hint=hint;setText(value);setSingleLine(true)}
 override fun onCreate(savedInstanceState:Bundle?){super.onCreate(savedInstanceState);showHome()}
 private fun layout(title:String){
  val scroll=ScrollView(this);root=LinearLayout(this).apply{orientation=LinearLayout.VERTICAL;setPadding(20,20,20,28);setBackgroundColor(Color.WHITE)}
  scroll.addView(root);setContentView(scroll);root.addView(label(title,23f))
 }
 private fun showHome(){layout("EUM SMS GUARD")
  root.addView(label("삼성 메시지는 계속 기본 문자 앱으로 사용합니다. 이 앱은 메시지 알림의 사본을 분석하며, 원본 문자 차단·삭제·복원은 불가능합니다."))
  val enabled=Switch(this).apply {text="알림 감지 활성화";isChecked=prefs.getBoolean("enabled",false);setOnCheckedChangeListener{_,v->prefs.edit().putBoolean("enabled",v).apply()} };root.addView(enabled)
  button("알림 접근 권한 설정") { startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)) }
  button("격리함 / 분석 기록") {showEvents()}
  button("차단 문구 관리") {showRules()}
  button("AI 서버 및 개인정보 동의") {showSettings()}
  button("삼성 메시지에서 새 문자 작성") {try{startActivity(Intent(Intent.ACTION_SENDTO,Uri.parse("smsto:")))}catch(_:Exception){Toast.makeText(this,"문자 앱을 찾지 못했습니다",Toast.LENGTH_SHORT).show()}}
 }
 private fun showRules(){layout("차단 문구 관리")
  val e=edit("차단할 문구 입력");root.addView(e);button("문구 추가") {store.addRule(e.text.toString());showRules()}
  store.rules().forEach { s->root.addView(label(s));button("삭제: $s"){store.removeRule(s);showRules()} }
  button("돌아가기"){showHome()}
 }
 private fun showEvents(){layout("격리함 / 분석 기록")
  root.addView(label("격리 해제는 이 앱의 분류 상태만 변경합니다. 삼성 메시지의 원본은 변경하지 않습니다."))
  store.events().forEach {ev->
   root.addView(label("${if(ev.quarantined) "[격리]" else "[허용]"} ${ev.sender}\n${ev.body}\n사유: ${ev.reason}"))
   if(ev.quarantined)button("격리 해제 #${ev.id}"){store.release(ev.id);showEvents()}
  }
  button("돌아가기"){showHome()}
 }
 private fun showSettings(){layout("AI 서버 설정")
  root.addView(label("문자 내용과 발신자 표시가 외부 서버로 전송될 수 있습니다. 신뢰할 수 있는 HTTPS 서버만 사용하세요. 인증 토큰은 현재 기기 앱 설정에 저장되며 보안 저장소 암호화는 미구현입니다."))
  val endpoint=edit("https://서버주소/analyze",prefs.getString("endpoint","")?:"");root.addView(endpoint)
  val token=edit("서버 인증 토큰",prefs.getString("token","")?:"");root.addView(token)
  val consent=CheckBox(this).apply{text="외부 서버로 문자 내용 전송에 동의";isChecked=prefs.getBoolean("cloud_consent",false)};root.addView(consent)
  button("저장") {val url=endpoint.text.toString().trim();if(url.isNotEmpty()&&!url.startsWith("https://")){Toast.makeText(this,"HTTPS 주소만 가능합니다",Toast.LENGTH_SHORT).show();return@button};prefs.edit().putString("endpoint",url).putString("token",token.text.toString()).putBoolean("cloud_consent",consent.isChecked).apply();showHome()}
  button("돌아가기"){showHome()}
 }
 override fun onBackPressed(){showHome()}
}
