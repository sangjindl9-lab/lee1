using System;

namespace RebuildCity.Sim
{
    /// <summary>시드 기반 결정적 난수(xorshift64). 상태를 저장하면 저장·불러오기 후에도 같은 결과가 나온다.</summary>
    public sealed class Rng
    {
        public ulong State;

        public Rng(ulong seed) { State = seed == 0 ? 0x9E3779B97F4A7C15UL : seed; }

        public ulong NextU64()
        {
            ulong x = State;
            x ^= x << 13; x ^= x >> 7; x ^= x << 17;
            State = x;
            return x;
        }

        public double NextDouble() { return (NextU64() >> 11) * (1.0 / 9007199254740992.0); }
        public double Range(double min, double max) { return min + (max - min) * NextDouble(); }
        public int Range(int min, int maxExclusive) { return min + (int)(NextDouble() * (maxExclusive - min)); }
    }

    /// <summary>모든 명령의 반환값: 성공 여부와 실패 코드.</summary>
    public struct Result
    {
        public bool Ok;
        public string Code;
        public string Message;

        public static Result Success() { return new Result { Ok = true, Code = "OK", Message = "" }; }
        public static Result Fail(string code, string message) { return new Result { Ok = false, Code = code, Message = message }; }
        public override string ToString() { return Ok ? "OK" : Code + ": " + Message; }
    }

    public static class Mathx
    {
        public static double Clamp(double v, double min, double max) { return v < min ? min : (v > max ? max : v); }
        public static double Dist(double ax, double az, double bx, double bz)
        {
            double dx = ax - bx, dz = az - bz;
            return Math.Sqrt(dx * dx + dz * dz);
        }
    }

    /// <summary>시뮬레이션 시간. 1틱 = 게임 시간 1분. 이동은 1틱 = 0.5초로 계산한다.</summary>
    public static class SimTime
    {
        public const int TicksPerHour = 60;
        public const int TicksPerDay = 1440;
        public const double TickSeconds = 0.5;
        public const int WorkStartHour = 8;
        public const int WorkEndHour = 18;

        public static int Day(long tick) { return (int)(tick / TicksPerDay) + 1; }
        public static int Hour(long tick) { return (int)(tick % TicksPerDay) / 60; }
        public static int Minute(long tick) { return (int)(tick % 60); }
        public static bool IsWorkHour(long tick) { int h = Hour(tick); return h >= WorkStartHour && h < WorkEndHour; }
    }
}
