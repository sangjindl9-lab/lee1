package com.eum.smsguard

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

class Store(ctx: Context): SQLiteOpenHelper(ctx,"guard.db",null,1) {
 override fun onCreate(db:SQLiteDatabase) {
  db.execSQL("CREATE TABLE events(id INTEGER PRIMARY KEY AUTOINCREMENT, sender TEXT, body TEXT, reason TEXT, verdict TEXT, quarantined INTEGER, created INTEGER)")
  db.execSQL("CREATE TABLE rules(id INTEGER PRIMARY KEY AUTOINCREMENT, phrase TEXT UNIQUE NOT NULL)")
 }
 override fun onUpgrade(db:SQLiteDatabase, oldVersion:Int, newVersion:Int) {}
 fun add(sender:String,body:String,reason:String,verdict:String,quarantined:Boolean) {
  writableDatabase.execSQL("INSERT INTO events(sender,body,reason,verdict,quarantined,created) VALUES(?,?,?,?,?,?)", arrayOf(sender,body,reason,verdict,if(quarantined) 1 else 0,System.currentTimeMillis()))
 }
 fun rules():List<String> { val out= mutableListOf<String>(); readableDatabase.rawQuery("SELECT phrase FROM rules ORDER BY id DESC",null).use { while(it.moveToNext())out.add(it.getString(0)) }; return out }
 fun addRule(s:String) { if(s.isNotBlank()) writableDatabase.execSQL("INSERT OR IGNORE INTO rules(phrase) VALUES(?)",arrayOf(s.trim())) }
 fun removeRule(s:String) { writableDatabase.execSQL("DELETE FROM rules WHERE phrase=?",arrayOf(s)) }
 data class Event(val id:Long,val sender:String,val body:String,val reason:String,val verdict:String,val quarantined:Boolean)
 fun events():List<Event> { val out= mutableListOf<Event>(); readableDatabase.rawQuery("SELECT id,sender,body,reason,verdict,quarantined FROM events ORDER BY id DESC LIMIT 300",null).use { while(it.moveToNext()) out.add(Event(it.getLong(0),it.getString(1)?:"",it.getString(2)?:"",it.getString(3)?:"",it.getString(4)?:"",it.getInt(5)==1)) }; return out }
 fun release(id:Long) { writableDatabase.execSQL("UPDATE events SET quarantined=0 WHERE id=?",arrayOf(id)) }
}
