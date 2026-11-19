# Streamy Kit — 지금 켜져 있는 프로그램 창 목록 (윈도우에서 직접 읽음)
# 방송 엔진의 창 조회 기능을 반복해서 쓰면 화면 프로세스가 죽는 PC가 있어서, 엔진과 완전히 따로 돌립니다.
# 2초마다 JSON 한 줄: [{ exe, title, cls, value }]   value = 엔진(OBS) 창 지정 형식 "제목:클래스:실행파일"
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

namespace StreamyWin {
  public static class Lister {
    delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int idx);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int val, int size);
    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr h, int flags, StringBuilder s, ref int n);

    static string Esc(string s) {
      var b = new StringBuilder();
      foreach (var c in s) {
        if (c == '"') b.Append("\\\""); else if (c == '\\') b.Append("\\\\");
        else if (c < 0x20) b.Append(string.Format("\\u{0:x4}", (int)c)); else b.Append(c);
      }
      return b.ToString();
    }
    // OBS 창 문자열 인코딩: '#' → "#22", ':' → "#3A"
    static string Obs(string s) { return s.Replace("#", "#22").Replace(":", "#3A"); }

    static Dictionary<uint, string> exeCache = new Dictionary<uint, string>();
    static string ExeOf(uint pid) {
      string e;
      if (exeCache.TryGetValue(pid, out e)) return e;
      e = "";
      IntPtr h = OpenProcess(0x1000, false, pid);   // PROCESS_QUERY_LIMITED_INFORMATION
      if (h != IntPtr.Zero) {
        var sb = new StringBuilder(1024); int n = sb.Capacity;
        if (QueryFullProcessImageName(h, 0, sb, ref n)) e = sb.ToString();
        CloseHandle(h);
      }
      exeCache[pid] = e;
      return e;
    }

    public static string Snapshot(int selfPid) {
      var items = new List<string>();
      EnumWindows((h, l) => {
        if (!IsWindowVisible(h)) return true;
        if (GetWindow(h, 4) != IntPtr.Zero) return true;                       // 소유 창(대화상자 등) 제외
        int ex = GetWindowLong(h, -20);
        if ((ex & 0x80) != 0) return true;                                       // WS_EX_TOOLWINDOW 제외
        int cloaked = 0;
        try { DwmGetWindowAttribute(h, 14, out cloaked, 4); } catch {}
        if (cloaked != 0) return true;                                           // 숨겨진 앱 창 제외
        var t = new StringBuilder(512); GetWindowText(h, t, t.Capacity);
        string title = t.ToString().Trim();
        if (title.Length == 0) return true;
        var c = new StringBuilder(256); GetClassName(h, c, c.Capacity);
        uint pid; GetWindowThreadProcessId(h, out pid);
        if (pid == selfPid) return true;
        string full = ExeOf(pid);
        if (full.Length == 0) return true;
        string exe = Path.GetFileName(full);
        string value = Obs(title) + ":" + Obs(c.ToString()) + ":" + Obs(exe);
        items.Add("{\"exe\":\"" + Esc(exe) + "\",\"title\":\"" + Esc(title) + "\",\"cls\":\"" + Esc(c.ToString()) + "\",\"path\":\"" + Esc(full) + "\",\"pid\":" + pid + ",\"value\":\"" + Esc(value) + "\"}");
        return true;
      }, IntPtr.Zero);
      if (exeCache.Count > 2000) exeCache.Clear();
      return "[" + string.Join(",", items.ToArray()) + "]";
    }
  }
}
'@

$self = $PID
$last = ''
$n = 0
while ($true) {
  try {
    $s = [StreamyWin.Lister]::Snapshot($self)
    # 바뀌었을 때만 보내고, 그래도 10초에 한 번은 보냄
    if ($s -ne $last -or ($n % 5) -eq 0) { [Console]::Out.WriteLine($s); [Console]::Out.Flush(); $last = $s }
  } catch {
    [Console]::Out.WriteLine('{"error":"' + ($_.Exception.Message -replace '"', "'") + '"}'); [Console]::Out.Flush()
  }
  $n++
  Start-Sleep -Milliseconds 2000
}
