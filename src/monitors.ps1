# Streamy Kit — 모니터 목록 (OBS 모니터 캡처가 쓰는 장치 ID 형식 그대로). 엔진에 묻지 않고 윈도우에서 직접 읽음
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
namespace StreamyMon {
  public static class Lister {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct DISPLAY_DEVICE { public int cb; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string DeviceName; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceString; public int StateFlags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceID; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceKey; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct DEVMODE { [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmDeviceName; public short dmSpecVersion, dmDriverVersion, dmSize, dmDriverExtra; public int dmFields; public int dmPositionX, dmPositionY; public int dmDisplayOrientation, dmDisplayFixedOutput; public short dmColor, dmDuplex, dmYResolution, dmTTOption, dmCollate; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmFormName; public short dmLogPixels; public int dmBitsPerPel, dmPelsWidth, dmPelsHeight, dmDisplayFlags, dmDisplayFrequency; }
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool EnumDisplayDevices(string dev, uint i, ref DISPLAY_DEVICE dd, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool EnumDisplaySettings(string dev, int mode, ref DEVMODE dm);
    static string Esc(string s) { return (s ?? "").Replace("\\", "\\\\").Replace("\"", "\\\""); }
    public static string List() {
      var o = new List<string>();
      for (uint i = 0; ; i++) {
        var a = new DISPLAY_DEVICE(); a.cb = Marshal.SizeOf(a);
        if (!EnumDisplayDevices(null, i, ref a, 0)) break;
        if ((a.StateFlags & 1) == 0) continue;               // 바탕화면에 붙은 것만
        var m = new DISPLAY_DEVICE(); m.cb = Marshal.SizeOf(m);
        if (!EnumDisplayDevices(a.DeviceName, 0, ref m, 1)) continue;   // EDD_GET_DEVICE_INTERFACE_NAME
        var dm = new DEVMODE(); dm.dmSize = (short)Marshal.SizeOf(dm);
        EnumDisplaySettings(a.DeviceName, -1, ref dm);
        o.Add(string.Format("{{\"id\":\"{0}\",\"name\":\"{1}\",\"x\":{2},\"y\":{3},\"w\":{4},\"h\":{5},\"primary\":{6}}}", Esc(m.DeviceID), Esc(m.DeviceString), dm.dmPositionX, dm.dmPositionY, dm.dmPelsWidth, dm.dmPelsHeight, (a.StateFlags & 4) != 0 ? "true" : "false"));
      }
      return "[" + string.Join(",", o) + "]";
    }
  }
}
'@
[StreamyMon.Lister]::List()
