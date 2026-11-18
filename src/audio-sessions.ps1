# Streamy Kit — 지금 소리를 내고 있는 프로그램 목록 (윈도우 오디오 세션)
# 기본 출력 장치의 오디오 세션을 0.15초마다 읽어서, 프로그램별 현재 소리 크기를 JSON 한 줄로 출력합니다.
# 방송 엔진과 별개로 돌기 때문에 이 스크립트에 문제가 생겨도 엔진은 영향을 받지 않습니다.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace StreamyAudio {
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorCom {}

  [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator {
    int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
    [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
  }

  [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice {
    [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
  }

  [Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionManager2 {
    int NotImpl1();
    int NotImpl2();
    [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator sessionEnum);
  }

  [Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionEnumerator {
    [PreserveSig] int GetCount(out int count);
    [PreserveSig] int GetSession(int index, out IAudioSessionControl2 session);
  }

  [Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionControl2 {
    [PreserveSig] int GetState(out int state);
    [PreserveSig] int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string name);
    int SetDisplayName();
    int GetIconPath();
    int SetIconPath();
    int GetGroupingParam();
    int SetGroupingParam();
    int RegisterAudioSessionNotification();
    int UnregisterAudioSessionNotification();
    int GetSessionIdentifier();
    int GetSessionInstanceIdentifier();
    [PreserveSig] int GetProcessId(out uint pid);
    [PreserveSig] int IsSystemSoundsSession();
  }

  [Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioMeterInformation {
    [PreserveSig] int GetPeakValue(out float peak);
  }

  public static class Sessions {
    static IAudioSessionManager2 mgr;
    static DateTime mgrAt = DateTime.MinValue;
    static readonly Dictionary<uint, string[]> procCache = new Dictionary<uint, string[]>();

    static IAudioSessionManager2 Manager() {
      // 기본 출력 장치가 바뀔 수 있으니 5초마다 다시 잡음
      if (mgr != null && (DateTime.UtcNow - mgrAt).TotalSeconds < 5) return mgr;
      var en = (IMMDeviceEnumerator)new MMDeviceEnumeratorCom();
      IMMDevice dev;
      if (en.GetDefaultAudioEndpoint(0 /*eRender*/, 1 /*eMultimedia*/, out dev) != 0 || dev == null) { mgr = null; return null; }
      var iid = typeof(IAudioSessionManager2).GUID;
      object o;
      if (dev.Activate(ref iid, 23 /*CLSCTX_ALL*/, IntPtr.Zero, out o) != 0) { mgr = null; return null; }
      mgr = (IAudioSessionManager2)o; mgrAt = DateTime.UtcNow;
      return mgr;
    }

    static string[] ProcInfo(uint pid) {
      string[] v;
      if (procCache.TryGetValue(pid, out v)) return v;
      try {
        var p = Process.GetProcessById((int)pid);
        string title = "";
        try { title = p.MainWindowTitle ?? ""; } catch {}
        string desc = "";
        try { desc = p.MainModule.FileVersionInfo.FileDescription ?? ""; } catch {}
        v = new[] { p.ProcessName + ".exe", desc, title };
      } catch { v = new[] { "", "", "" }; }
      procCache[pid] = v;
      return v;
    }

    static string Esc(string s) {
      var sb = new StringBuilder();
      foreach (var c in s ?? "") {
        if (c == '"' || c == '\\') { sb.Append('\\').Append(c); }
        else if (c < 0x20) { sb.Append(' '); }
        else sb.Append(c);
      }
      return sb.ToString();
    }

    public static string Snapshot() {
      var m = Manager();
      if (m == null) return "[]";
      IAudioSessionEnumerator se;
      if (m.GetSessionEnumerator(out se) != 0 || se == null) { mgr = null; return "[]"; }
      int n; se.GetCount(out n);
      var byExe = new Dictionary<string, object[]>(StringComparer.OrdinalIgnoreCase);
      for (int i = 0; i < n; i++) {
        IAudioSessionControl2 s;
        if (se.GetSession(i, out s) != 0 || s == null) continue;
        try {
          if (s.IsSystemSoundsSession() == 0) continue;           // 윈도우 알림음 제외 (S_OK = 시스템 소리)
          uint pid; s.GetProcessId(out pid);
          if (pid == 0) continue;
          int state; s.GetState(out state);                       // 0 비활성, 1 활성, 2 만료
          if (state == 2) continue;
          float peak = 0f;
          var meter = s as IAudioMeterInformation;
          if (meter != null) meter.GetPeakValue(out peak);
          var info = ProcInfo(pid);
          if (info[0] == "") continue;
          object[] prev;
          if (byExe.TryGetValue(info[0], out prev)) { if (peak > (float)prev[1]) prev[1] = peak; }
          else byExe[info[0]] = new object[] { info, peak, state };
        } finally { Marshal.ReleaseComObject(s); }
      }
      Marshal.ReleaseComObject(se);
      var sb = new StringBuilder("[");
      bool first = true;
      foreach (var kv in byExe) {
        var info = (string[])kv.Value[0];
        if (!first) sb.Append(','); first = false;
        sb.Append("{\"exe\":\"").Append(Esc(info[0])).Append("\",\"desc\":\"").Append(Esc(info[1]))
          .Append("\",\"title\":\"").Append(Esc(info[2])).Append("\",\"peak\":")
          .Append(((float)kv.Value[1]).ToString("0.000", System.Globalization.CultureInfo.InvariantCulture))
          .Append(",\"active\":").Append((int)kv.Value[2] == 1 ? "true" : "false").Append('}');
      }
      sb.Append(']');
      return sb.ToString();
    }
  }
}
'@

$errors = 0
while ($true) {
  try {
    [Console]::Out.WriteLine([StreamyAudio.Sessions]::Snapshot())
    [Console]::Out.Flush()
    $errors = 0
  } catch {
    $errors++
    [Console]::Out.WriteLine('{"error":"' + ($_.Exception.Message -replace '"', "'") + '"}')
    [Console]::Out.Flush()
    if ($errors -gt 20) { exit 1 }
  }
  Start-Sleep -Milliseconds 150
}
