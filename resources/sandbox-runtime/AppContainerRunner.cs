// Pi Agenda 的 Windows AppContainer 命令宿主。仅授予指定项目与临时目录，不启用网络能力。
using System;
using System.IO;
using System.Text;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;

class AppContainerRunner {
  [StructLayout(LayoutKind.Sequential)] struct Caps { public IntPtr Sid, Capabilities; public uint Count, Reserved; }
  [StructLayout(LayoutKind.Sequential)] struct SidAttr { public IntPtr Sid; public uint Attributes; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct Startup { public uint cb; public string reserved, desktop, title; public uint x,y,xSize,ySize,xCount,yCount,fill,flags; public ushort show, reservedSize; public IntPtr reservedBytes,input,output,error; }
  [StructLayout(LayoutKind.Sequential)] struct StartupEx { public Startup startup; public IntPtr attributes; }
  [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr process, thread; public uint pid, tid; }
  [StructLayout(LayoutKind.Sequential)] struct Limits { public long processTime,jobTime; public uint flags; public UIntPtr minimum,maximum; public uint active; public UIntPtr affinity; public uint priority,scheduling; }
  [StructLayout(LayoutKind.Sequential)] struct IoCounters { public ulong r,w,o,rb,wb,ob; }
  [StructLayout(LayoutKind.Sequential)] struct JobLimits { public Limits limits; public IoCounters io; public UIntPtr pm,jm,ppm,pjm; }
  [DllImport("userenv.dll",CharSet=CharSet.Unicode)] static extern int DeriveAppContainerSidFromAppContainerName(string name,out IntPtr sid);
  [DllImport("userenv.dll",CharSet=CharSet.Unicode)] static extern int CreateAppContainerProfile(string name,string display,string description,IntPtr caps,uint count,out IntPtr sid);
  [DllImport("userenv.dll",CharSet=CharSet.Unicode)] static extern int DeleteAppContainerProfile(string name);
  [DllImport("kernelbase.dll",CharSet=CharSet.Unicode,ExactSpelling=true,SetLastError=true)] static extern bool DeriveCapabilitySidsFromName(string name,out IntPtr groups,out uint groupCount,out IntPtr sids,out uint count);
  [DllImport("advapi32.dll")] static extern IntPtr FreeSid(IntPtr sid);
  [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr ptr);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list,int count,int flags,ref IntPtr size);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list,uint flags,IntPtr attribute,IntPtr value,IntPtr size,IntPtr previous,IntPtr returned);
  [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcessW(string application,StringBuilder command,IntPtr processAttrs,IntPtr threadAttrs,bool inherit,uint flags,IntPtr env,string cwd,ref StartupEx startup,out ProcessInfo process);
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int which);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetHandleInformation(IntPtr handle,uint mask,uint flags);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateFileW(string name,uint access,uint share,IntPtr attrs,uint disposition,uint flags,IntPtr template);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern uint GetFinalPathNameByHandleW(IntPtr file,StringBuilder path,uint length,uint flags);
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool GetKernelObjectSecurity(IntPtr handle,uint info,byte[] descriptor,uint length,out uint needed);
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool SetKernelObjectSecurity(IntPtr handle,uint info,byte[] descriptor);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateJobObjectW(IntPtr attrs,string name);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int info,ref JobLimits limits,uint length);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
  [DllImport("kernel32.dll",SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr obj,uint ms);
  [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr process,out uint code);
  [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr process,uint code);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  static void Require(bool ok,string action) { if(!ok) throw new Win32Exception(Marshal.GetLastWin32Error(),action); }
  static string Canonical(IntPtr handle) { var result=new StringBuilder(32768); uint n=GetFinalPathNameByHandleW(handle,result,(uint)result.Capacity,0); Require(n>0 && n<result.Capacity,"无法确认目录边界"); string p=result.ToString(); return p.StartsWith("\\\\?\\UNC\\") ? "\\\\"+p.Substring(8) : p.StartsWith("\\\\?\\") ? p.Substring(4) : p; }
  static bool Within(string p,string root) { return p.Equals(root,StringComparison.OrdinalIgnoreCase)||p.StartsWith(root.TrimEnd('\\')+"\\",StringComparison.OrdinalIgnoreCase); }
  static void Grant(string entry,string root,SecurityIdentifier sid,bool readOnly,bool deny) {
    // 固定文件句柄且不跟随重解析点，避免 ACL 操作被目录联接转移到项目外。
    var h=CreateFileW(entry,0x60080,7,IntPtr.Zero,3,0x02200000,IntPtr.Zero);
    Require(h!=new IntPtr(-1),"无法设置项目隔离权限："+entry);
    try {
      Require(Within(Canonical(h),root),"文件路径已越过项目边界");
      uint needed; GetKernelObjectSecurity(h,4,null,0,out needed); var bytes=new byte[needed]; Require(GetKernelObjectSecurity(h,4,bytes,needed,out needed),"无法读取项目权限");
      var descriptor=new RawSecurityDescriptor(bytes,0);
      bool directory=(File.GetAttributes(entry)&FileAttributes.Directory)!=0;
      var acl=descriptor.DiscretionaryAcl;
      if(acl==null) throw new InvalidOperationException("项目权限缺少访问控制列表，无法建立严格隔离");
      var inheritance=directory ? AceFlags.ContainerInherit|AceFlags.ObjectInherit : AceFlags.None;
      int rights=deny ? 0x1f01ff : readOnly ? 0x1200a9 : 0x1301bf;
      // 保留其他身份原有 ACE 的顺序；只插入本次临时身份，不依赖 .NET 的 ACL 重排。
      if(deny || readOnly) acl.InsertAce(0,new CommonAce(inheritance,AceQualifier.AccessDenied,deny ? rights : 0x000d0156,sid,false,null));
      if(!deny) { int at=0; while(at<acl.Count && (acl[at].AceFlags&AceFlags.Inherited)==0) at++; acl.InsertAce(at,new CommonAce(inheritance,AceQualifier.AccessAllowed,rights,sid,false,null)); }
      bytes=new byte[descriptor.BinaryLength]; descriptor.GetBinaryForm(bytes,0);
      Require(SetKernelObjectSecurity(h,4,bytes),"无法写入项目隔离权限");
    } finally { CloseHandle(h); }
  }
  static void GrantTree(string root,SecurityIdentifier sid,List<string> protectedPaths) {
    var pending=new Stack<string>(); pending.Push(root);
    while(pending.Count>0) {
      string p=pending.Pop(); var attrs=File.GetAttributes(p); if((attrs&FileAttributes.ReparsePoint)!=0) continue;
      bool deny=false,readOnly=false;
      foreach(var target in protectedPaths) if(Within(p,target)) { if(Path.GetFileName(target)==".git") readOnly=true; else deny=true; }
      Grant(p,root,sid,readOnly,deny);
      if((attrs&FileAttributes.Directory)!=0) foreach(string child in Directory.EnumerateFileSystemEntries(p)) pending.Push(child);
    }
  }
  static void CleanupTree(string root,SecurityIdentifier sid) {
    if(!Directory.Exists(root)) return;
    var pending=new Stack<string>(); pending.Push(root);
    while(pending.Count>0) {
      string p=pending.Pop(); var attrs=File.GetAttributes(p); if((attrs&FileAttributes.ReparsePoint)!=0) continue;
      RemoveGrant(p,root,sid);
      if((attrs&FileAttributes.Directory)!=0) foreach(string child in Directory.EnumerateFileSystemEntries(p)) pending.Push(child);
    }
  }
  static void RemoveGrant(string entry,string root,SecurityIdentifier sid) {
    var h=CreateFileW(entry,0x60080,7,IntPtr.Zero,3,0x02200000,IntPtr.Zero); if(h==new IntPtr(-1)) return;
    try {
      Require(Within(Canonical(h),root),"清理路径已越过项目边界"); uint needed; GetKernelObjectSecurity(h,4,null,0,out needed); var bytes=new byte[needed]; Require(GetKernelObjectSecurity(h,4,bytes,needed,out needed),"无法读取临时隔离权限");
      var descriptor=new RawSecurityDescriptor(bytes,0); var acl=descriptor.DiscretionaryAcl; bool changed=false;
      if(acl==null) return;
      for(int i=acl.Count-1;i>=0;i--) { var ace=acl[i] as KnownAce; if(ace!=null && ace.SecurityIdentifier.Equals(sid)) { acl.RemoveAce(i); changed=true; } }
      if(changed) { bytes=new byte[descriptor.BinaryLength]; descriptor.GetBinaryForm(bytes,0); Require(SetKernelObjectSecurity(h,4,bytes),"无法清理临时隔离权限"); }
    } finally { CloseHandle(h); }
  }
  static IntPtr Capability(string name) {
    IntPtr groups,sids; uint gc,count; Require(DeriveCapabilitySidsFromName(name,out groups,out gc,out sids,out count),"无法创建系统运行库能力");
    try { Require(count==1,"系统运行库能力数量错误"); return Marshal.ReadIntPtr(sids); }
    finally { for(uint i=0;i<gc;i++) LocalFree(Marshal.ReadIntPtr(groups,(int)i*IntPtr.Size)); LocalFree(groups); LocalFree(sids); }
  }
  static int Execute(string moniker,string project,string scratch,string encoded,List<string> protectedPaths) {
    IntPtr sid; int profileResult=CreateAppContainerProfile(moniker,moniker,"Pi Agenda 临时命令隔离",IntPtr.Zero,0,out sid);
    bool created=profileResult==0;
    if(profileResult==unchecked((int)0x800700b7)) Marshal.ThrowExceptionForHR(DeriveAppContainerSidFromAppContainerName(moniker,out sid)); else Marshal.ThrowExceptionForHR(profileResult);
    var identity=new SecurityIdentifier(sid); GrantTree(project,identity,protectedPaths); GrantTree(scratch,identity,new List<string>());
    IntPtr size=IntPtr.Zero; InitializeProcThreadAttributeList(IntPtr.Zero,3,0,ref size);
    IntPtr list=Marshal.AllocHGlobal(size), capsMemory=IntPtr.Zero,policy=IntPtr.Zero,handleList=IntPtr.Zero,capList=IntPtr.Zero,job=IntPtr.Zero;
    var capabilitySids=new List<IntPtr>();
    var process=new ProcessInfo();
    try {
      Require(InitializeProcThreadAttributeList(list,3,0,ref size),"无法初始化隔离进程属性");
      foreach(string capability in new[]{"registryRead","lpacInstrumentation","lpacCom"}) capabilitySids.Add(Capability(capability));
      int sidSize=Marshal.SizeOf(typeof(SidAttr)); capList=Marshal.AllocHGlobal(sidSize*capabilitySids.Count);
      for(int i=0;i<capabilitySids.Count;i++) Marshal.StructureToPtr(new SidAttr { Sid=capabilitySids[i],Attributes=4 },new IntPtr(capList.ToInt64()+i*sidSize),false);
      var caps=new Caps { Sid=sid,Capabilities=capList,Count=(uint)capabilitySids.Count }; capsMemory=Marshal.AllocHGlobal(Marshal.SizeOf(typeof(Caps))); Marshal.StructureToPtr(caps,capsMemory,false);
      Require(UpdateProcThreadAttribute(list,0,new IntPtr(0x20009),capsMemory,new IntPtr(Marshal.SizeOf(typeof(Caps))),IntPtr.Zero,IntPtr.Zero),"无法启用 AppContainer");
      policy=Marshal.AllocHGlobal(4); Marshal.WriteInt32(policy,1);
      Require(UpdateProcThreadAttribute(list,0,new IntPtr(0x2000f),policy,new IntPtr(4),IntPtr.Zero,IntPtr.Zero),"无法启用低权限 AppContainer");
      var startup=new StartupEx(); startup.attributes=list; startup.startup.cb=(uint)Marshal.SizeOf(typeof(StartupEx)); startup.startup.flags=0x100;
      startup.startup.input=GetStdHandle(-10); startup.startup.output=GetStdHandle(-11); startup.startup.error=GetStdHandle(-12);
      var handles=new List<IntPtr>(); foreach(var h in new []{startup.startup.input,startup.startup.output,startup.startup.error}) if(h!=IntPtr.Zero&&h!=new IntPtr(-1)&&!handles.Contains(h)) { Require(SetHandleInformation(h,1,1),"无法继承输出管道"); handles.Add(h); }
      handleList=Marshal.AllocHGlobal(IntPtr.Size*handles.Count); for(int i=0;i<handles.Count;i++) Marshal.WriteIntPtr(handleList,i*IntPtr.Size,handles[i]);
      Require(UpdateProcThreadAttribute(list,0,new IntPtr(0x20002),handleList,new IntPtr(IntPtr.Size*handles.Count),IntPtr.Zero,IntPtr.Zero),"无法限制继承句柄");
      job=CreateJobObjectW(IntPtr.Zero,null); Require(job!=IntPtr.Zero,"无法创建进程组"); var limits=new JobLimits(); limits.limits.flags=0x2000; Require(SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(JobLimits))),"无法设置子进程退出限制");
      string shell=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows),"System32\\WindowsPowerShell\\v1.0\\powershell.exe");
      var command=new StringBuilder("\""+shell+"\" -NoProfile -NonInteractive -ExecutionPolicy Bypass -OutputFormat Text -EncodedCommand "+encoded);
      Require(CreateProcessW(shell,command,IntPtr.Zero,IntPtr.Zero,true,0x08080404,IntPtr.Zero,project,ref startup,out process),"无法启动严格隔离进程");
      Require(AssignProcessToJobObject(job,process.process),"无法限制子进程"); Require(ResumeThread(process.thread)!=0xffffffff,"无法运行隔离进程");
      WaitForSingleObject(process.process,0xffffffff); uint code; Require(GetExitCodeProcess(process.process,out code),"无法读取隔离退出状态"); return unchecked((int)code);
    } finally {
      if(process.process!=IntPtr.Zero) { TerminateProcess(process.process,1); CloseHandle(process.process); } if(process.thread!=IntPtr.Zero) CloseHandle(process.thread);
      if(job!=IntPtr.Zero) CloseHandle(job); DeleteProcThreadAttributeList(list); Marshal.FreeHGlobal(list);
      foreach(var p in new[]{capsMemory,policy,handleList,capList}) if(p!=IntPtr.Zero) Marshal.FreeHGlobal(p);
      foreach(var capabilitySid in capabilitySids) LocalFree(capabilitySid); FreeSid(sid); if(created) DeleteAppContainerProfile(moniker);
    }
  }
  static int Main(string[] args) {
    Console.OutputEncoding=new UTF8Encoding(false);
    try {
      if(args.Length<4 || !args[0].StartsWith("pi-agenda.")) throw new ArgumentException("隔离宿主参数不足");
      if(args[3]=="cleanup") { IntPtr sid; Marshal.ThrowExceptionForHR(DeriveAppContainerSidFromAppContainerName(args[0],out sid)); try { var identity=new SecurityIdentifier(sid); CleanupTree(Path.GetFullPath(args[1]),identity); CleanupTree(Path.GetFullPath(args[2]),identity); return 0; } finally { FreeSid(sid); DeleteAppContainerProfile(args[0]); } }
      var protect=new List<string>(); for(int i=4;i<args.Length;i++) protect.Add(Path.GetFullPath(args[i]));
      return Execute(args[0],Path.GetFullPath(args[1]).TrimEnd('\\'),Path.GetFullPath(args[2]).TrimEnd('\\'),args[3],protect);
    } catch(Exception error) { Console.Error.WriteLine("AppContainer 隔离失败："+error.Message+(error is Win32Exception ? " (Windows "+((Win32Exception)error).NativeErrorCode+")" : "")); return 1; }
  }
}
